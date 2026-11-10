/**
 * Subcomandos do aprendizado, do pouso e do registro de `loop.mjs` (GM-13). T8 entrega `aprendizado` e `aprendizados`;
 * `registro` é da T11; `pousar` é da T12 (sem mod).
 * As dependências vêm injetadas por `loop.mjs` (`{ c, plano, gravar, lerDiarioEstrito, Falha, git, raizPrincipal, cwd, pronto }`): este módulo não importa `loop.mjs`.
 *
 *   loop.mjs aprendizado <E|A> <D|M> --regra <t> --entra-em <a,b> [--gatilho <sessao:seq>] [--eventos <s:q,…>] [--fonte <f> --numero <n>] [--substitui [<entrega>/]<sessao:seq>]
 *   loop.mjs aprendizado nada --gatilho <sessao:seq> --motivo <t>
 *   loop.mjs aprendizados [--para <instantaneo|spec|brief:<papel>>]      (não exige entrega na branch nem plano: lê a árvore da raiz principal)
 *
 * ORDEM DO `aprendizado` (cada passo recusa sem gravar; só o 1º é rc 2):
 *   1 uso → 2 conversão (`argumento_invalido`) → 3 canário em todo texto digitado (`segredo_no_aprendizado`: `append` com canário GRAVA `diario.recusa`,
 *   por isso vem antes de qualquer outra coisa) → 4 forma (`forma_invalida`) → 5 `ls-files` literal da fonte (`fonte_nao_versionada`) →
 *   6 leitura da árvore (`diario_ilegivel` se `substitui` aponta para entrega ilegível) → 7 `gravar(…, antes)`, em que `antes(candidato, eventos)` valida
 *   as referências (e a pendência do `nada`) sobre os MESMOS eventos que o `gravar` leu: sem 2ª leitura, sem janela entre validar e gravar.
 * CONTRATO DE FALHA. Ausente (diário sem eventos, árvore sem a pasta) ≠ corrompido (linha torta, cadeia quebrada); nunca vira "0" calado.
 */
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { join, relative } from 'node:path';
import { aprendizadosVigentes, paraDestino, validarAprendizado } from '../dist/aprendizado.js';
import { lerAprendizados, projetar, recusaCanario } from '../dist/diario.js';
import { formaInvalida, PAPEIS } from '../dist/formas.js';
import { pendenciasAprendizado } from '../dist/pendencias.js';
import { montarRegistro } from '../dist/registro.js';
import { lerX, tasksEmVoo } from '../dist/pouso.js';

const USO = 'uso: loop.mjs aprendizado <E|A> <D|M> --regra <t> --entra-em <a,b> [--gatilho <sessao:seq>] [--eventos <s:q,…>] [--fonte <f> --numero <n>] [--substitui [<entrega>/]<sessao:seq>] [--entrega GM-10] [--sessao <id>] | aprendizado nada --gatilho <sessao:seq> --motivo <t> | aprendizados [--para <instantaneo|spec|brief:<papel>>]';
const SESSAO_RE = /^[A-Za-z0-9._-]{1,128}$/;
const SEQ_RE = /^[1-9]\d{0,8}$/;
const ENTREGA_RE = /^[A-Z]+-\d+$/;
const NUMERO_RE = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const CODIGOS_DE_REFERENCIA = ['gatilho_inexistente', 'evento_inexistente', 'substitui_inexistente'];
const DESTINOS = ['instantaneo', 'spec', ...PAPEIS.map((p) => `brief:${p}`)];
const FLAGS_NADA = ['gatilho', 'motivo', 'entrega', 'sessao'];

const uso = (Falha, msg) => new Falha('uso', `${msg}. ${USO}`, {}, 2);
const invalido = (Falha, msg) => new Falha('argumento_invalido', msg);

/** `<sessao>:<seq>` (separa no ÚLTIMO `:`); nunca ecoa o valor digitado. */
function refDe(Falha, nome, texto) {
  const i = texto.lastIndexOf(':');
  const sessao = i < 0 ? '' : texto.slice(0, i);
  const seq = i < 0 ? '' : texto.slice(i + 1);
  if (!SESSAO_RE.test(sessao) || !SEQ_RE.test(seq)) {
    throw invalido(Falha, `${nome}: esperado <sessao>:<seq> (sessao de letras, dígitos, ., _ ou -; seq inteiro >= 1 sem zeros à esquerda)`);
  }
  return { sessao, seq: Number(seq) };
}

function listaDeRefs(Falha, nome, texto) {
  return texto.split(',').map((item) => {
    if (item === '') throw invalido(Falha, `${nome}: item vazio na lista (esperado <sessao>:<seq>,<sessao>:<seq>)`);
    return refDe(Falha, nome, item);
  });
}

function substituiDe(Falha, texto) {
  const i = texto.indexOf('/');
  if (i < 0) return refDe(Falha, '--substitui', texto);
  const entrega = texto.slice(0, i);
  if (!ENTREGA_RE.test(entrega)) throw invalido(Falha, `--substitui: entrega fora da forma ${ENTREGA_RE} (esperado [<entrega>/]<sessao:seq>)`);
  return { ...refDe(Falha, '--substitui', texto.slice(i + 1)), entrega };
}

/** `--numero` só decimal estrito: `''`, `" 12 "`, `0x10`, `1e3`, `NaN` não passam pela conversão de `Number`. */
function numeroDe(Falha, texto) {
  const n = NUMERO_RE.test(texto) ? Number(texto) : Number.NaN;
  if (!Number.isFinite(n)) throw invalido(Falha, '--numero: esperado número decimal (ex.: 3, -1, 2.5), sem espaço, expoente nem prefixo');
  return n;
}

/** Passos 1 a 3 (uso, conversão e canário): só dependem dos argumentos, então rodam antes de abrir entrega, plano e diário. */
export function preparar(Falha, pos, flags) {
  const eNada = pos[0] === 'nada';
  let dados;
  if (eNada) {
    if (pos.length !== 1) throw uso(Falha, 'aprendizado nada não tem posicionais além de `nada`');
    const fora = Object.keys(flags).find((n) => !FLAGS_NADA.includes(n));
    if (fora !== undefined) throw uso(Falha, `--${fora} não vale para aprendizado nada`);
    for (const n of ['gatilho', 'motivo']) if (!Object.hasOwn(flags, n)) throw uso(Falha, `aprendizado nada exige --${n}`);
  } else {
    if (pos.length !== 2 || !['E', 'A'].includes(pos[0]) || !['D', 'M'].includes(pos[1])) throw uso(Falha, 'aprendizado espera `<E|A> <D|M>` ou `nada`');
    for (const n of ['regra', 'entra-em']) if (!Object.hasOwn(flags, n)) throw uso(Falha, `aprendizado ${pos[0]} ${pos[1]} exige --${n}`);
    if (Object.hasOwn(flags, 'motivo')) throw uso(Falha, '--motivo só vale para aprendizado nada');
    if (Object.hasOwn(flags, 'fonte') !== Object.hasOwn(flags, 'numero')) throw uso(Falha, '--fonte e --numero andam juntos (a medição é {fonte, numero})');
  }
  if (eNada) {
    dados = { gatilho: refDe(Falha, '--gatilho', flags.gatilho), motivo: flags.motivo };
  } else {
    const evidencia = {};
    if (flags.eventos !== undefined) evidencia.eventos = listaDeRefs(Falha, '--eventos', flags.eventos);
    if (flags.fonte !== undefined) evidencia.medicao = { fonte: flags.fonte, numero: numeroDe(Falha, flags.numero) };
    dados = {
      tipo: pos[0], status: pos[1], gatilho: flags.gatilho === undefined ? null : refDe(Falha, '--gatilho', flags.gatilho), evidencia,
      regra: flags.regra, entra_em: flags['entra-em'].split(','),
      ...(flags.substitui !== undefined ? { substitui: substituiDe(Falha, flags.substitui) } : {}),
    };
  }
  // Canário em TODO texto digitado, antes de qualquer leitura: `append` com canário grava `diario.recusa` e só depois falha.
  for (const [nome, valor] of Object.entries(flags)) {
    const padrao = recusaCanario(valor);
    if (padrao !== null) throw new Falha('segredo_no_aprendizado', `--${nome} casa o canário de segredo (${padrao}); nada foi gravado`);
  }
  return { tipo: eNada ? 'aprendizado.nada' : 'aprendizado', dados };
}

/** Fonte de arquivo: `ls-files` LITERAL na raiz principal, e a saída tem de ser exatamente a fonte (diretório e glob não são arquivo versionado). */
function versionada(deps, fonte) {
  let saida;
  try {
    saida = deps.git(deps.c.raiz, '--literal-pathspecs', 'ls-files', '-z', '--error-unmatch', '--', fonte);
  } catch {
    return false;
  }
  return saida === `${fonte}\0`;
}

const codigoDe = (motivo) => {
  const prefixo = motivo.split(': ')[0];
  return CODIGOS_DE_REFERENCIA.includes(prefixo) ? prefixo : 'forma_invalida';
};

export function aprendizado(deps, pos, flags) {
  const { c, plano, gravar, Falha } = deps;
  const { tipo, dados } = deps.pronto ?? preparar(Falha, pos, flags);
  const forma = formaInvalida(tipo, dados);
  if (forma !== null) throw new Falha('forma_invalida', `${forma}; nada foi gravado`);
  const fonte = dados.evidencia?.medicao?.fonte;
  if (typeof fonte === 'string' && !fonte.startsWith('evento:') && !versionada(deps, fonte)) {
    throw new Falha('fonte_nao_versionada', `fonte ${fonte} não é arquivo versionado no git (ls-files literal na raiz principal): grave como M; nada foi gravado`);
  }
  const { porEntrega, avisos } = lerAprendizados(join(c.raiz, '.harness', 'entregas'));
  const alvo = dados.substitui?.entrega;
  if (alvo !== undefined && alvo !== c.entrega) {
    const aviso = avisos.find((a) => a.startsWith(`aprendizados: ${alvo} ilegível`) || a.includes('pasta das entregas não lista'));
    if (aviso !== undefined) throw new Falha('diario_ilegivel', `--substitui aponta para a entrega ${alvo}, cuja árvore não lê (${aviso}); nada foi gravado`);
  }
  const antes = (candidato, eventos) => {
    if (tipo === 'aprendizado.nada') {
      const abertas = pendenciasAprendizado(plano, eventos);
      if (!abertas.some((p) => p.sessao === dados.gatilho.sessao && p.seq === dados.gatilho.seq)) {
        const lista = abertas.length === 0 ? 'nenhuma' : abertas.map((p) => `${p.sessao}:${p.seq}`).join(', ');
        throw new Falha('pendencia_inexistente', `${dados.gatilho.sessao}:${dados.gatilho.seq} não é pendência aberta de aprendizado (abertas: ${lista}); nada foi gravado`);
      }
      return;
    }
    const motivo = validarAprendizado(eventos, dados, c.entrega, porEntrega);
    if (motivo !== null) throw new Falha(codigoDe(motivo), `${motivo}; nada foi gravado`);
  };
  // `gravar` devolve `{tipo, ...dados}` e o `tipo` E|A do aprendizado cobre o tipo do evento: `tipo_evento` diz qual evento foi gravado.
  return { evento: { ...gravar(c, plano, tipo, dados, antes), tipo_evento: tipo } };
}

/** Não abre entrega nem plano: só `raizPrincipal(cwd)` (injetada). Árvore ilegível vira aviso; nunca "0" calado. */
export function aprendizados(deps, pos, flags) {
  const { Falha } = deps;
  if (pos.length !== 0) throw uso(Falha, 'aprendizados não tem posicionais');
  if (flags.para !== undefined && !DESTINOS.includes(flags.para)) throw invalido(Falha, `--para: esperado ${DESTINOS.join(' | ')}`);
  const raiz = deps.raizPrincipal(deps.cwd);
  const { porEntrega, avisos } = lerAprendizados(join(raiz, '.harness', 'entregas'));
  const vigentes = aprendizadosVigentes(porEntrega);
  const lista = flags.para === undefined ? vigentes.filter((a) => a.status === 'D') : paraDestino(vigentes, flags.para);
  return {
    aprendizados: lista.map((a) => ({ entrega: a.entrega, sessao: a.sessao, seq: a.seq, ts: a.ts, tipo: a.tipo, regra: a.regra, entra_em: a.entra_em })),
    avisos,
  };
}

/**
 * `loop.mjs pousar` (REQ-POU-3, sem mod; GM-13 T12): grava `sessao.pouso {percent: null, x, via: 'dono'}` só na fronteira, isto é, com 0 tasks em
 * `implementando|corrigindo|em_revisao` (`tasksEmVoo`, núcleo). A conferência roda DENTRO do `antes` do `gravar`, sobre os eventos que ele leu:
 * sem 2ª leitura. Diário ausente (sem eventos) não tem task em voo ⇒ grava; ilegível, fora de ordem ou fora da tabela ⇒ erro e nada gravado.
 * `x` vem só de `GABARITO_POUSO_X`, pelo `lerX` do mod (inválido ⇒ 50 com `aviso`). Não grava `sessao.retomada` nem `loop.parar`.
 * Devolve o instantâneo que o `SessionStart` mostra agora (mesmas opções do cartão: aprendizados D de `instantaneo`, REQ-APR-3).
 */
export function pousar(deps, pos, flags) {
  const { c, plano, gravar, Falha } = deps;
  if (pos.length !== 0) throw new Falha('uso', 'pousar não tem posicionais; nada foi gravado', {}, 2);
  const { x, aviso } = lerX(process.env.GABARITO_POUSO_X);
  let lidos = null;
  let candidato = null;
  const antes = (cand, eventos) => {
    lidos = eventos;
    candidato = cand;
    const voo = tasksEmVoo(plano, eventos);
    if (!voo.ok) {
      const codigo = voo.motivo === 'plano ilegível' ? 'plano_ilegivel' : 'diario_ilegivel';
      throw new Falha(codigo, `${voo.motivo}; nada foi gravado`);
    }
    if (voo.tasks.length > 0) {
      throw new Falha('task_em_voo', `task em voo: ${voo.tasks.join(', ')} (implementando, corrigindo ou em revisão); pouse depois que ela sair de voo; nada foi gravado`);
    }
  };
  const evento = gravar(c, plano, 'sessao.pouso', { percent: null, x, via: 'dono' }, antes);
  const arvore = lerAprendizados(join(c.raiz, '.harness', 'entregas'));
  const aprendizados = paraDestino(aprendizadosVigentes(arvore.porEntrega), 'instantaneo');
  const { instantaneo } = projetar([...lidos, candidato], { aprendizados, avisosAprendizados: arvore.avisos });
  return { evento, instantaneo, ...(aviso !== null ? { aviso: [aviso] } : {}) };
}
/** Canário em cada string folha dos eventos, sem corte nem limpeza (chave de objeto não vai ao registro). Nome do padrão, ou `null`. */
function canarioNasFolhas(eventos) {
  const pilha = [eventos];
  while (pilha.length > 0) {
    const x = pilha.pop();
    if (typeof x === 'string') {
      const r = recusaCanario(x);
      if (r !== null) return r;
    } else if (Array.isArray(x)) {
      for (const y of x) pilha.push(y);
    } else if (x !== null && typeof x === 'object') {
      for (const y of Object.values(x)) pilha.push(y);
    }
  }
  return null;
}

/**
 * `loop.mjs registro` (REQ-REG-1): `<dirEntrega>/registro.md` a partir do diário, determinístico (mesmo diário ⇒ mesmo byte).
 * Diário AUSENTE (sem eventos) ⇒ registro com as seções em `- nenhum`; ILEGÍVEL (linha torta, cadeia quebrada, fora de ordem, evento fora
 * da forma) ⇒ `diario_ilegivel` e nada gravado, nem arquivo temporário. Segredo no texto renderizado ⇒ `segredo_no_registro`, nada gravado.
 * Escrita por tmp no mesmo diretório + rename, e releitura do arquivo: o `sha256` devolvido é o dos bytes que estão no disco.
 */
export function registro(deps, pos, flags) {
  const { c, plano, lerDiarioEstrito, Falha } = deps;
  if (pos.length !== 0) throw uso(Falha, 'registro não tem posicionais');
  const eventos = lerDiarioEstrito(c.dirEntrega);
  const spec = deps.shaDaSpec(c.raiz, plano);
  let texto;
  try {
    texto = montarRegistro(c.entrega, eventos, spec.ok ? spec.sha256 : null);
  } catch (e) {
    throw new Falha('diario_ilegivel', `${e instanceof Error ? e.message : String(e)}; nada foi gravado`);
  }
  // O canário roda sobre o texto INTEIRO de cada campo do diário (o corte de 240 do registro poderia partir um segredo e escondê-lo) e, por segurança, sobre o resultado.
  const padrao = canarioNasFolhas(eventos) ?? recusaCanario(texto);
  if (padrao !== null) throw new Falha('segredo_no_registro', `o registro casaria o canário de segredo (${padrao}); nada foi gravado`);
  const destino = join(c.dirEntrega, 'registro.md');
  const tmp = join(c.dirEntrega, `.registro.md.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const fd = openSync(tmp, 'wx', 0o644);
    try { writeSync(fd, texto); } finally { closeSync(fd); }
    renameSync(tmp, destino);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* nunca chegou a existir */ }
    throw new Falha('registro_nao_gravado', `registro.md não foi gravado (${e.code ?? e.message})`);
  }
  const sha256 = createHash('sha256').update(texto).digest('hex');
  const lido = createHash('sha256').update(readFileSync(destino)).digest('hex');
  if (lido !== sha256) throw new Falha('registro_sem_efeito', 'o registro.md relido não tem os bytes gerados: confira o disco');
  return { arquivo: relative(c.raiz, destino), sha256 };
}

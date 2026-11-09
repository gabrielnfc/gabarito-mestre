/**
 * Núcleo puro da entrega (REQ-ENT-1/ENT-2, GM-11 T4): mesma entrada, mesma saída. Sem E/S e sem relógio:
 * o instante entra só por `agoraMs`, o fuso só por `Intl`. A ordem das linhas de `decidirEntrega` é o contrato
 * (decisões da Sombra D4-1 e D4-2): o que deixa prod em estado desconhecido vem antes de qualquer leitura de `fim`.
 */

import { ordenar } from './loop.ts';
import { formaInvalida } from './formas.ts';
import type { Evento, Janela, MotivoParar, PoliticaEntrega, PoliticaPlano } from './tipos.ts';

export type ComandoEntrega = { argv: string[]; timeout_s: number };
export type ComandosEntrega = { deploy?: ComandoEntrega; smoke?: ComandoEntrega; rollback?: ComandoEntrega };
export type ConfigEntrega = {
  politica: PoliticaEntrega;
  base: string;
  janela: Janela | null;
  comandos: ComandosEntrega;
  erros: string[];
};
export type DecisaoEntrega =
  | { tipo: 'subir' }
  | { tipo: 'agendar'; quando: string }
  | { tipo: 'release_pr'; base: string; aviso?: string }
  | { tipo: 'esperar'; motivo: 'homolog'; aviso?: string }
  | { tipo: 'entregue' }
  | { tipo: 'parar'; motivo: MotivoParar };

const POLITICAS: readonly string[] = ['continua', 'janela', 'sob_demanda'];
const RANK: Record<PoliticaEntrega, number> = { continua: 0, janela: 1, sob_demanda: 2 };
const NOMES_COMANDO = ['deploy', 'smoke', 'rollback'] as const;
const TIMEOUT_PADRAO_S = 600;
const BASE_RE = /^[A-Za-z0-9._/][A-Za-z0-9._/-]*$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTO_MS = 60_000;
const OITO_DIAS_MS = 8 * 24 * 60 * MINUTO_MS;

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const minutos = (hhmm: string): number => {
  const m = HHMM_RE.exec(hhmm) as RegExpExecArray;
  return Number(m[1]) * 60 + Number(m[2]);
};

/** `null` = janela utilizável; senão o motivo. Nunca lança: o `Intl` que recusa o fuso vira motivo. */
function janelaInvalida(j: unknown): string | null {
  if (!ehObjeto(j)) return 'janela: esperado objeto { dias, inicio, fim, fuso }';
  const { dias, inicio, fim, fuso } = j;
  if (!Array.isArray(dias) || dias.length === 0 || !dias.every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)) {
    return 'janela.dias: esperado lista não vazia de inteiros 0-6';
  }
  if (typeof inicio !== 'string' || !HHMM_RE.test(inicio)) return 'janela.inicio: esperado HH:MM entre 00:00 e 23:59';
  if (typeof fim !== 'string' || !HHMM_RE.test(fim)) return 'janela.fim: esperado HH:MM entre 00:00 e 23:59';
  if (typeof fuso !== 'string' || fuso === '') return 'janela.fuso: esperado nome IANA';
  try {
    new Intl.DateTimeFormat('en', { timeZone: fuso });
  } catch {
    return `janela.fuso: o Intl recusa "${fuso}"`;
  }
  return null;
}

function lerComando(nome: string, bruto: unknown, erros: string[]): ComandoEntrega | undefined {
  if (!ehObjeto(bruto)) {
    erros.push(`comandos.${nome}: esperado objeto { argv, timeout_s? }`);
    return undefined;
  }
  const { argv, timeout_s: timeout } = bruto;
  if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === 'string')) {
    erros.push(`comandos.${nome}.argv: esperado lista não vazia de textos`);
    return undefined;
  }
  if ((argv[0] as string).trim() === '') {
    erros.push(`comandos.${nome}.argv[0]: vazio`);
    return undefined;
  }
  if (argv.some((a) => (a as string).includes('\0'))) {
    erros.push(`comandos.${nome}.argv: elemento com NUL`);
    return undefined;
  }
  if (timeout !== undefined && (!Number.isInteger(timeout) || (timeout as number) <= 0)) {
    erros.push(`comandos.${nome}.timeout_s: esperado inteiro > 0`);
    return undefined;
  }
  return { argv: argv as string[], timeout_s: timeout === undefined ? TIMEOUT_PADRAO_S : (timeout as number) };
}

/**
 * Lê `entrega` do config de `origin/HEAD`. Campo inválido ⇒ default do campo + texto em `erros`; nunca lança.
 * Ausente (sem erro) e corrompido (com erro) são casos distintos.
 */
export function lerConfigEntrega(cfg: unknown): ConfigEntrega {
  const saida: ConfigEntrega = { politica: 'sob_demanda', base: 'main', janela: null, comandos: {}, erros: [] };
  if (cfg === null || cfg === undefined) return saida;
  if (!ehObjeto(cfg)) {
    saida.erros.push('config: esperado objeto');
    return saida;
  }
  const bruto = cfg.entrega;
  if (bruto === undefined) return saida;
  if (!ehObjeto(bruto)) {
    saida.erros.push('entrega: esperado objeto');
    return saida;
  }
  let politica: PoliticaEntrega = 'sob_demanda';
  if (bruto.politica !== undefined) {
    if (typeof bruto.politica === 'string' && POLITICAS.includes(bruto.politica)) politica = bruto.politica as PoliticaEntrega;
    else saida.erros.push('entrega.politica: esperado continua, janela ou sob_demanda');
  }
  if (bruto.janela !== undefined || politica === 'janela') {
    const erro = bruto.janela === undefined ? 'entrega.janela: ausente com politica "janela"' : janelaInvalida(bruto.janela);
    if (erro === null) {
      const j = bruto.janela as Janela;
      saida.janela = { dias: [...j.dias], inicio: j.inicio, fim: j.fim, fuso: j.fuso };
    } else {
      saida.erros.push(erro.startsWith('entrega.') ? erro : `entrega.${erro}`);
      // falha para o lado de menos deploy, sem travar o loop
      if (politica === 'janela') politica = 'sob_demanda';
    }
  }
  saida.politica = politica;
  if (bruto.base !== undefined) {
    const b = bruto.base;
    if (typeof b === 'string' && BASE_RE.test(b) && !b.includes('..')) saida.base = b;
    else saida.erros.push('entrega.base: nome de branch inválido (usa main)');
  }
  if (bruto.comandos !== undefined) {
    if (!ehObjeto(bruto.comandos)) saida.erros.push('entrega.comandos: esperado objeto');
    else {
      for (const nome of NOMES_COMANDO) {
        if (bruto.comandos[nome] === undefined) continue;
        const c = lerComando(nome, bruto.comandos[nome], saida.erros);
        if (c) saida.comandos[nome] = c;
      }
    }
  }
  return saida;
}

/** Política efetiva: o plano só aperta (`continua` → `janela` → `sob_demanda`); afrouxar é recusado. */
export function politicaEfetiva(
  c: ConfigEntrega,
  p?: PoliticaPlano,
): { ok: true; politica: PoliticaEntrega; janela: Janela | null } | { ok: false; erro: 'politica_afrouxada' | 'janela_ausente'; mensagem: string } {
  const pedida = p?.politica;
  if (pedida === undefined || !POLITICAS.includes(pedida)) return resolver(c.politica, c.janela);
  if (RANK[pedida] < RANK[c.politica]) {
    return { ok: false, erro: 'politica_afrouxada', mensagem: `o plano pede "${pedida}", mais frouxo que o config ("${c.politica}"): o plano só aperta` };
  }
  // `janela` do config vence quando o config já é `janela`; o plano que aperta `continua` → `janela` traz a dele
  const janela = c.politica === 'janela' ? c.janela : (p?.janela ?? c.janela);
  return resolver(pedida, janela);
}

function resolver(
  politica: PoliticaEntrega,
  janela: Janela | null,
): { ok: true; politica: PoliticaEntrega; janela: Janela | null } | { ok: false; erro: 'janela_ausente'; mensagem: string } {
  if (politica !== 'janela') return { ok: true, politica, janela: null };
  if (janela === null) return { ok: false, erro: 'janela_ausente', mensagem: 'política "janela" sem janela declarada no plano nem no config' };
  return { ok: true, politica, janela };
}

/**
 * Avaliador de "dentro da janela" com um `Intl.DateTimeFormat` só (11.520 chamadas de `formatToParts` custam ~11 ms).
 * Janela meio-aberta `[inicio, fim)` por minuto inteiro; segundos descartados; `fim ≤ inicio` cruza a meia-noite e o dia
 * é o do início. Dia local por `formatToParts` + `Date.UTC(...).getUTCDay()`; hora por `hourCycle: 'h23'`.
 * Janela que o `Intl` recusa ⇒ nunca dentro (não lança).
 */
function avaliador(j: Janela): ((ms: number) => boolean) | null {
  if (janelaInvalida(j) !== null) return null;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: j.fuso, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  });
  const ini = minutos(j.inicio);
  const fim = minutos(j.fim);
  return (ms: number): boolean => {
    const partes: Record<string, number> = {};
    for (const p of fmt.formatToParts(ms)) if (p.type !== 'literal') partes[p.type] = Number(p.value);
    const dia = new Date(Date.UTC(partes.year, partes.month - 1, partes.day)).getUTCDay();
    const m = (partes.hour % 24) * 60 + partes.minute;
    if (fim > ini) return j.dias.includes(dia) && m >= ini && m < fim;
    if (m >= ini) return j.dias.includes(dia);
    if (m < fim) return j.dias.includes((dia + 6) % 7);
    return false;
  };
}

export function dentroDaJanela(j: Janela, agoraMs: number): boolean {
  if (!Number.isFinite(agoraMs)) return false;
  const dentro = avaliador(j);
  return dentro === null ? false : dentro(agoraMs);
}

/** 1º `t` múltiplo de 60.000 com `t ≥ agoraMs`, até `agoraMs + 8 dias`, dentro da janela; não achou ⇒ `null`. */
export function proximaAbertura(j: Janela, agoraMs: number): string | null {
  if (!Number.isFinite(agoraMs)) return null;
  const dentro = avaliador(j);
  if (dentro === null) return null;
  const limite = agoraMs + OITO_DIAS_MS;
  for (let t = Math.ceil(agoraMs / MINUTO_MS) * MINUTO_MS; t <= limite; t += MINUTO_MS) {
    if (dentro(t)) return new Date(t).toISOString();
  }
  return null;
}

const dadosDe = (e: Evento): Record<string, unknown> => (ehObjeto(e.dados) ? e.dados : {});
const valido = (e: Evento): boolean => formaInvalida(e.tipo, e.dados) === null;
const parar = (motivo: MotivoParar): DecisaoEntrega => ({ tipo: 'parar', motivo });

/**
 * Decisão de entrega (REQ-ENT-1/ENT-2). `L` = última `task.integrada`; `I` = último `entrega.inicio` de forma válida;
 * `F` = 1º `entrega.fim` de forma válida depois de `I`. Posição é a de `ordenar`, nunca o `ts`. `entrega.agendada` e
 * `entrega.smoke` não decidem nada: quem chama em ou depois de `quando` cai de novo na janela pelo `agoraMs`.
 */
export function decidirEntrega(e: {
  politica: PoliticaEntrega;
  janela: Janela | null;
  exigeProd: boolean;
  base: string;
  comandos: ComandosEntrega;
  eventos: Evento[];
  agoraMs: number;
}): DecisaoEntrega {
  // 0. diário fora de ordem: a função é total
  const o = ordenar(e.eventos);
  if (!o.ok) return parar('diario_invalido');
  const evs = o.eventos;
  // política que não é `continua` nem `janela` se comporta como `sob_demanda` (lado de menos deploy)
  const politica: PoliticaEntrega = e.politica === 'continua' || e.politica === 'janela' ? e.politica : 'sob_demanda';
  // 1.
  if (e.exigeProd && politica === 'sob_demanda') return parar('janela_ausente');

  let L = -1;
  let I = -1;
  evs.forEach((ev, i) => {
    if (ev.tipo === 'task.integrada') L = i;
    if (ev.tipo === 'entrega.inicio' && valido(ev)) I = i;
  });
  let F = -1;
  if (I >= 0) F = evs.findIndex((ev, i) => i > I && ev.tipo === 'entrega.fim' && valido(ev));

  // 2. `inicio` sem `fim`: prod em estado desconhecido, com qualquer `L`
  if (I >= 0 && F < 0) {
    const rollbackFalho = evs.some((ev, i) => i > I && ev.tipo === 'entrega.rollback' && valido(ev) && dadosDe(ev).ok === false);
    return parar(rollbackFalho ? 'rollback' : 'nao_conseguiu');
  }
  if (F >= 0) {
    const fim = dadosDe(evs[F]);
    // 3. rollback falho fica fixo até o dono agir
    if (fim.ok === false && fim.motivo === 'rollback') return parar('rollback');
    if (I > L) {
      // 4. e 5. a entrega deste ciclo (código integrado) já tem desfecho
      if (fim.ok === true) return { tipo: 'entregue' };
      return parar(fim.motivo === 'smoke' ? 'smoke' : 'nao_conseguiu');
    }
  }
  // 6. nada integrado, nada a entregar
  if (L < 0) return parar('nao_conseguiu');
  // 7.
  if (politica === 'sob_demanda') return { tipo: 'release_pr', base: e.base };
  // 8.
  const ausentes = NOMES_COMANDO.filter((n) => e.comandos[n] === undefined);
  if (ausentes.length > 0) {
    if (e.exigeProd) return parar('janela_ausente');
    return { tipo: 'release_pr', base: e.base, aviso: `faltam comandos de entrega no config: ${ausentes.join(', ')}` };
  }
  // 9-11. homolog verde posterior à última integração
  const H = evs
    .filter((ev, i) => i > L && ev.tipo === 'ci.resultado' && dadosDe(ev).alvo === 'homolog' && typeof dadosDe(ev).verde === 'boolean')
    .map((ev) => dadosDe(ev).verde as boolean);
  if (H.length === 0) return { tipo: 'esperar', motivo: 'homolog' };
  if (H[H.length - 1] === false) {
    if (H.length >= 2 && H[H.length - 2] === false) return parar('ci_vermelho');
    return { tipo: 'esperar', motivo: 'homolog', aviso: 'CI de homolog vermelho depois da última integração (1×): a entrega espera o próximo resultado' };
  }
  // 12.
  if (politica === 'continua') return { tipo: 'subir' };
  // 13-15. `janela`
  if (e.janela === null) return parar('janela_ausente');
  if (dentroDaJanela(e.janela, e.agoraMs)) return { tipo: 'subir' };
  const quando = proximaAbertura(e.janela, e.agoraMs);
  return quando === null ? parar('janela_ausente') : { tipo: 'agendar', quando };
}

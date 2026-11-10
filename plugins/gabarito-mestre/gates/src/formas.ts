/**
 * Forma de `dados` por tipo de evento do diário (GM-11 T1, REQ-SOM-2, EME-1, ENT-2). Núcleo puro e total: `formaInvalida` nunca lança,
 * qualquer `dados` (null, array, texto, número, objeto com `__proto__`, getter que lança) vira motivo, nunca exceção.
 *
 * Contrato de falha: `dados` ausente (`undefined`) e `dados` corrompido (qualquer valor que não seja objeto simples) têm motivos distintos;
 * campo obrigatório ausente e campo inválido também. Só vale propriedade própria: o que vem do prototype não conta (D1).
 * `null` = forma ok ou tipo sem regra. Tipos da E1/E2 não ganham regra nova, salvo os campos opcionais de `ci.resultado`,
 * `custo.medicao` e (E4) `task.iniciada.modelo` e `task.integrada.mutacoes`; para eles, `dados` que não é objeto segue aceito (é o que o diário aceita hoje: nenhum evento existente passa a ser recusado).
 */

import type { Papel } from './tipos.ts';

/** `REQ-<ÁREA>-<n>`, padrão inteiro (âncoras): `REQ-A-1x` e minúscula não casam. */
export const REQ_RE: RegExp = /^REQ-[A-Z0-9]+-\d+$/;

const HASH_RE = /^[0-9a-f]{64}$/;
const TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const CAUSAS: readonly string[] = ['regra_negocio', 'tecnica'];
const ORIGENS: readonly string[] = ['dono', 'sombra'];
const POLITICAS: readonly string[] = ['continua', 'janela', 'sob_demanda'];
const MOTIVOS_FIM: readonly string[] = ['deploy', 'smoke', 'rollback'];
const RESPOSTA_MAX = 1000;
const MOTIVO_DEVOLVIDA_MAX = 200;
const MODELOS_TASK: readonly string[] = ['haiku', 'sonnet', 'opus', 'fable'];
/** Papéis de task do loop (fonte única: `loop.ts` reexporta; aqui porque `loop.ts` já importa `formas.ts` via `emenda.ts`). */
export const PAPEIS: readonly Papel[] = ['implementador', 'revisor', 'correcao'];
const SESSAO_RE = /^[A-Za-z0-9._-]{1,128}$/;
/** Mesmo padrão de `ENTREGA_RE` em `scripts/loop.mjs`: chave de mapa, nunca caminho. */
const ENTREGA_RE = /^[A-Z]+-\d+$/;
const REGRA_MAX = 300;
const DESTINOS_FIXOS: readonly string[] = ['instantaneo', 'spec'];
const EVENTO_FONTE_RE = /^evento:([A-Za-z0-9._-]{1,128}):([1-9]\d*)$/;

type Obj = Record<string, unknown>;
const ehObjeto = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Só propriedade própria; `undefined` explícito vale como ausente. */
const campo = (o: Obj, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);
const texto = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const inteiroPositivo = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;

/** Cada regra devolve o motivo (citando o campo) ou `null`. */
type Regra = (o: Obj) => string | null;

const obrigatorio = (nome: string): string => `campo \`${nome}\` ausente`;

/** Texto não vazio (obrigatório). */
function exigirTexto(o: Obj, nome: string): string | null {
  const v = campo(o, nome);
  if (v === undefined) return obrigatorio(nome);
  return texto(v) ? null : `campo \`${nome}\` inválido: esperado texto não vazio`;
}

/** Texto não vazio (opcional). */
function opcionalTexto(o: Obj, nome: string): string | null {
  const v = campo(o, nome);
  if (v === undefined) return null;
  return texto(v) ? null : `campo \`${nome}\` inválido: esperado texto não vazio`;
}

function exigirReq(o: Obj, nome = 'req'): string | null {
  const v = campo(o, nome);
  if (v === undefined) return obrigatorio(nome);
  return typeof v === 'string' && REQ_RE.test(v) ? null : `campo \`${nome}\` inválido: ${JSON.stringify(v)} não casa REQ-<ÁREA>-<n>`;
}

function exigirEnum(o: Obj, nome: string, valores: readonly string[]): string | null {
  const v = campo(o, nome);
  if (v === undefined) return obrigatorio(nome);
  return typeof v === 'string' && valores.includes(v) ? null : `campo \`${nome}\` inválido: esperado um de ${valores.join(' | ')}`;
}

function exigirBooleano(o: Obj, nome: string): string | null {
  const v = campo(o, nome);
  if (v === undefined) return obrigatorio(nome);
  return typeof v === 'boolean' ? null : `campo \`${nome}\` inválido: esperado booleano`;
}

function exigirHash(o: Obj): string | null {
  const v = campo(o, 'pergunta_hash');
  if (v === undefined) return obrigatorio('pergunta_hash');
  return typeof v === 'string' && HASH_RE.test(v) ? null : 'campo `pergunta_hash` inválido: esperado sha256 em hex minúsculo (64)';
}

function exigirReqOuTask(o: Obj): string | null {
  const req = campo(o, 'req');
  const task = campo(o, 'task');
  if (req !== undefined && task !== undefined) return 'campos `req` e `task` juntos: exatamente um dos dois';
  if (req === undefined && task === undefined) return 'campo `req` ou `task` ausente: exatamente um dos dois';
  return req !== undefined ? exigirReq(o) : exigirTexto(o, 'task');
}

function listaDeTextos(o: Obj, nome: string, { vazia }: { vazia: boolean }): string | null {
  const v = campo(o, nome);
  if (v === undefined) return obrigatorio(nome);
  if (!Array.isArray(v)) return `campo \`${nome}\` inválido: esperado lista de textos`;
  if (!vazia && v.length === 0) return `campo \`${nome}\` inválido: lista vazia`;
  return v.every(texto) ? null : `campo \`${nome}\` inválido: todo item deve ser texto não vazio`;
}

const inteiroPos = (o: Obj, nome: string): string | null => {
  const v = campo(o, nome);
  if (v === undefined) return obrigatorio(nome);
  return inteiroPositivo(v) ? null : `campo \`${nome}\` inválido: esperado inteiro ≥ 1`;
};

function exigirSha256(o: Obj): string | null {
  const v = campo(o, 'sha256');
  if (v === undefined) return obrigatorio('sha256');
  return typeof v === 'string' && HASH_RE.test(v) ? null : 'campo `sha256` inválido: esperado sha256 em hex minúsculo (64)';
}

function motivoDevolvida(o: Obj): string | null {
  const v = campo(o, 'motivo');
  if (v === undefined) return obrigatorio('motivo');
  if (typeof v !== 'string' || v.trim() === '') return 'campo `motivo` inválido: esperado texto não vazio';
  const n = [...v].length;
  return n > MOTIVO_DEVOLVIDA_MAX ? `campo \`motivo\` inválido: ${n} caracteres, máximo ${MOTIVO_DEVOLVIDA_MAX}` : null;
}

/** Ordem de checagem estável: o 1º defeito é o motivo. */
const primeiro = (...rs: (string | null)[]): string | null => rs.find((r) => r !== null) ?? null;

const decisaoSombra: Regra = (o) => {
  const resposta = campo(o, 'resposta');
  let respostaErro: string | null;
  if (resposta === undefined) respostaErro = obrigatorio('resposta');
  else if (typeof resposta !== 'string') respostaErro = 'campo `resposta` inválido: esperado texto';
  else {
    const n = [...resposta].length;
    respostaErro = resposta.trim() === '' ? 'campo `resposta` inválido: vazia' : n > RESPOSTA_MAX ? `campo \`resposta\` inválido: ${n} caracteres, máximo ${RESPOSTA_MAX}` : null;
  }
  const subst = campo(o, 'substitui');
  let substErro: string | null = null;
  if (subst !== undefined) {
    substErro = ehObjeto(subst) && texto(campo(subst, 'sessao')) && inteiroPositivo(campo(subst, 'seq'))
      ? null
      : 'campo `substitui` inválido: esperado {sessao: texto, seq: inteiro ≥ 1}';
  }
  const fora = campo(o, 'fora_da_regra');
  const foraErro = fora === undefined || fora === true ? null : 'campo `fora_da_regra` inválido: só `true` ou ausente';
  const emenda = campo(o, 'emenda_seq');
  const emendaErro = emenda === undefined ? null : inteiroPositivo(emenda) ? null : 'campo `emenda_seq` inválido: esperado inteiro ≥ 1';
  const fontes = campo(o, 'fontes');
  const medicao = campo(o, 'medicao');
  const fontesErro = fontes === undefined ? null : listaDeTextos(o, 'fontes', { vazia: false });
  const medicaoErro = medicao === undefined ? null : texto(medicao) ? null : 'campo `medicao` inválido: esperado texto não vazio';
  const base = primeiro(
    exigirHash(o), exigirReqOuTask(o), respostaErro, exigirTexto(o, 'arquivo'), exigirBooleano(o, 'pergunta_enviesada'),
    fontesErro, medicaoErro, substErro, foraErro, emendaErro,
  );
  if (base !== null) return base;
  if (fora === true) return emenda === undefined ? 'campo `emenda_seq` ausente: `fora_da_regra` exige a emenda que o cobre' : null;
  return fontes === undefined && medicao === undefined ? 'campo `fontes` ou `medicao` ausente: decisão sem fonte nem medição' : null;
};

function quando(o: Obj): string | null {
  const v = campo(o, 'quando');
  if (v === undefined) return obrigatorio('quando');
  const m = typeof v === 'string' ? TS_RE.exec(v) : null;
  const invalido = 'campo `quando` inválido: esperado instante ISO 8601 com fuso';
  if (m === null) return invalido;
  const [ano, mes, dia, h, mi, s] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i]));
  const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  if (mes < 1 || mes > 12 || dia < 1 || dia > diasNoMes || h > 23 || mi > 59 || s > 59) return invalido;
  return Number.isFinite(Date.parse(v as string)) ? null : invalido;
}

// ── E5a (GM-13 T1): aprendizado, aprendizado.nada, dono.mensagem ──────────────────────────────────────────────────────────────

const refEvento = (v: unknown): boolean => ehObjeto(v) && typeof campo(v, 'sessao') === 'string' && SESSAO_RE.test(campo(v, 'sessao') as string) && inteiroPositivo(campo(v, 'seq'));
const contar = (t: string): number => [...t].length;
const temControle = (t: string): boolean => [...t].some((ch) => { const c = ch.codePointAt(0) as number; return c < 0x20 || c === 0x7f; });

/** Fonte da medição: caminho relativo sem `..` (nunca absoluto, nunca barra invertida) ou `evento:<sessao>:<seq>`. */
function fonteValida(f: unknown): boolean {
  if (typeof f !== 'string' || f.trim() === '' || temControle(f)) return false;
  if (f.startsWith('evento:')) return EVENTO_FONTE_RE.test(f);
  if (f.includes('\\') || /^[A-Za-z]:/.test(f)) return false;
  // `/` inicial, `a//b` e `a/` viram segmento vazio: recusados junto com `..`.
  return f.split('/').every((seg) => seg !== '..' && seg !== '');
}

/** Obrigatório e do tipo `RefEvento`; `permiteNulo` aceita `null` (gatilho do aprendizado sem pendência). */
function exigirRef(o: Obj, nome: string, permiteNulo: boolean): string | null {
  const v = campo(o, nome);
  if (v === undefined) return obrigatorio(nome);
  if (v === null) return permiteNulo ? null : `campo \`${nome}\` inválido: esperado {sessao, seq}, não null`;
  return refEvento(v) ? null : `campo \`${nome}\` inválido: esperado {sessao: texto da forma de sessão, seq: inteiro ≥ 1}`;
}

function exigirRegra(o: Obj, nome: string): string | null {
  const v = campo(o, nome);
  if (v === undefined) return obrigatorio(nome);
  if (typeof v !== 'string' || v.trim() === '') return `campo \`${nome}\` inválido: esperado texto não vazio`;
  const n = contar(v);
  return n > REGRA_MAX ? `campo \`${nome}\` inválido: ${n} caracteres, máximo ${REGRA_MAX}` : null;
}

function evidenciaDoAprendizado(o: Obj): string | null {
  const v = campo(o, 'evidencia');
  if (v === undefined) return obrigatorio('evidencia');
  const invalida = (m: string): string => `campo \`evidencia\` inválido: ${m}`;
  if (!ehObjeto(v)) return invalida('esperado objeto');
  const eventos = campo(v, 'eventos');
  if (eventos !== undefined && (!Array.isArray(eventos) || eventos.length === 0 || !eventos.every(refEvento))) return invalida('`eventos` esperado lista não vazia de {sessao, seq}');
  const medicao = campo(v, 'medicao');
  if (medicao !== undefined) {
    if (!ehObjeto(medicao)) return invalida('`medicao` esperado {fonte, numero}');
    const numero = campo(medicao, 'numero');
    if (typeof numero !== 'number' || !Number.isFinite(numero)) return invalida('`medicao.numero` esperado número finito');
    if (!fonteValida(campo(medicao, 'fonte'))) return invalida('`medicao.fonte` esperado caminho relativo sem `..` ou `evento:<sessao>:<seq>`');
  }
  return null;
}

function entraEm(o: Obj): string | null {
  const v = campo(o, 'entra_em');
  if (v === undefined) return obrigatorio('entra_em');
  const invalido = `campo \`entra_em\` inválido: esperado lista não vazia, sem repetição, de ${DESTINOS_FIXOS.join(' | ')} | brief:<${PAPEIS.join('|')}>`;
  if (!Array.isArray(v) || v.length === 0 || new Set(v).size !== v.length) return invalido;
  return v.every((d) => typeof d === 'string' && (DESTINOS_FIXOS.includes(d) || (d.startsWith('brief:') && PAPEIS.includes(d.slice(6) as Papel)))) ? null : invalido;
}

function substituiDoAprendizado(o: Obj): string | null {
  const v = campo(o, 'substitui');
  if (v === undefined) return null;
  const invalido = 'campo `substitui` inválido: esperado {sessao, seq, entrega?} com entrega da forma <SIGLA>-<n>';
  if (!refEvento(v)) return invalido;
  const entrega = campo(v as Obj, 'entrega');
  return entrega === undefined || (typeof entrega === 'string' && ENTREGA_RE.test(entrega)) ? null : invalido;
}

/** D só com evidência da máquina: sem `eventos` nem `medicao`, o motivo manda gravar como M. */
function dSemEvidencia(o: Obj): string | null {
  if (campo(o, 'status') !== 'D') return null;
  // `primeiro` avalia todos os argumentos: sem a chave (ou com tipo errado) a regra de `evidencia` já recusa; aqui nunca lança.
  const ev = campo(o, 'evidencia');
  if (!ehObjeto(ev)) return null;
  return campo(ev, 'eventos') === undefined && campo(ev, 'medicao') === undefined ? 'status `D` sem evidência da máquina (`eventos` ou `medicao`): grave como M' : null;
}

const aprendizado: Regra = (o) => primeiro(
  exigirEnum(o, 'tipo', ['E', 'A']), exigirEnum(o, 'status', ['D', 'M']), exigirRef(o, 'gatilho', true), evidenciaDoAprendizado(o),
  exigirRegra(o, 'regra'), entraEm(o), substituiDoAprendizado(o), dSemEvidencia(o),
);

const aprendizadoNada: Regra = (o) => primeiro(exigirRef(o, 'gatilho', false), exigirRegra(o, 'motivo'));

/** `dono.mensagem` carrega só o hash e o tamanho: qualquer outra chave (inclusive `texto`) é recusada, para o texto nunca chegar ao diário. */
const donoMensagem: Regra = (o) => {
  const chars = campo(o, 'chars');
  const charsErro = chars === undefined ? obrigatorio('chars') : typeof chars === 'number' && Number.isInteger(chars) && chars >= 0 ? null : 'campo `chars` inválido: esperado inteiro ≥ 0';
  const extra = Object.keys(o).find((k) => k !== 'sha256' && k !== 'chars');
  return primeiro(exigirSha256(o), charsErro, extra === undefined ? null : `campo \`${extra}\` não permitido: \`dono.mensagem\` carrega só {sha256, chars}`);
};

const REGRAS: ReadonlyMap<string, Regra> = new Map<string, Regra>([
  ['sombra.consulta', (o) => primeiro(exigirHash(o), exigirReqOuTask(o))],
  ['decisao.sombra', decisaoSombra],
  ['desvio', (o) => primeiro(exigirTexto(o, 'task'), exigirReq(o), exigirTexto(o, 'evidencia'), listaDeTextos(o, 'arquivos', { vazia: true }), exigirEnum(o, 'causa', CAUSAS))],
  ['descoberta', (o) => primeiro(exigirTexto(o, 'evidencia'), exigirEnum(o, 'causa', CAUSAS))],
  [
    'emenda.proposta',
    (o) => {
      const arquivos = campo(o, 'arquivos');
      return primeiro(
        exigirReq(o), opcionalTexto(o, 'task'), exigirTexto(o, 'diff'), exigirTexto(o, 'fato'), exigirTexto(o, 'alternativa'),
        exigirTexto(o, 'evidencia'), exigirEnum(o, 'causa', CAUSAS), arquivos === undefined ? null : listaDeTextos(o, 'arquivos', { vazia: true }),
      );
    },
  ],
  ['spec.emendada', (o) => primeiro(inteiroPos(o, 'proposta_seq'), exigirEnum(o, 'origem', ORIGENS))],
  ['emenda.rejeitada', (o) => primeiro(inteiroPos(o, 'proposta_seq'), exigirEnum(o, 'origem', ORIGENS))],
  ['entrega.inicio', (o) => exigirEnum(o, 'politica', POLITICAS)],
  ['entrega.smoke', (o) => exigirBooleano(o, 'ok')],
  ['entrega.rollback', (o) => exigirBooleano(o, 'ok')],
  [
    'entrega.fim',
    (o) => primeiro(exigirBooleano(o, 'ok'), campo(o, 'motivo') === undefined ? null : exigirEnum(o, 'motivo', MOTIVOS_FIM)),
  ],
  ['entrega.agendada', quando],
  // E4 (GM-12): `spec.aprovada` grava o caminho de `plano.spec` e o sha256 aprovado; `entrega.devolvida` guarda só o motivo (o comando nunca vai ao diário).
  ['spec.aprovada', (o) => primeiro(exigirTexto(o, 'spec'), exigirSha256(o))],
  ['entrega.devolvida', motivoDevolvida],
  // E5a (GM-13): aprendizado do diário, fechamento sem regra e mensagem do dono (hash e tamanho, nunca o texto).
  ['aprendizado', aprendizado],
  ['aprendizado.nada', aprendizadoNada],
  ['dono.mensagem', donoMensagem],
]);

/** Tipos da E1/E2 que ganharam só campos opcionais: `dados` que não é objeto segue aceito (nada que existe hoje passa a ser recusado). */
const REGRAS_OPCIONAIS: ReadonlyMap<string, Regra> = new Map<string, Regra>([
  [
    'ci.resultado',
    (o) => {
      const alvo = campo(o, 'alvo');
      return alvo === undefined || alvo === 'homolog' ? null : 'campo `alvo` inválido: só `homolog` ou ausente';
    },
  ],
  [
    // E4: `modelo` opcional (a task diz com que modelo o agente foi despachado); dado antigo sem o campo segue válido.
    'task.iniciada',
    (o) => {
      const modelo = campo(o, 'modelo');
      return modelo === undefined || (typeof modelo === 'string' && MODELOS_TASK.includes(modelo))
        ? null
        : `campo \`modelo\` inválido: esperado um de ${MODELOS_TASK.join(' | ')}`;
    },
  ],
  [
    // E4: `mutacoes {total, mortas}` opcional (contagem do gate de mutação desta task); `mortas ≤ total`.
    'task.integrada',
    (o) => {
      const m = campo(o, 'mutacoes');
      if (m === undefined) return null;
      const invalido = 'campo `mutacoes` inválido: esperado {total, mortas} inteiros ≥ 0 com mortas ≤ total';
      if (!ehObjeto(m)) return invalido;
      const total = campo(m, 'total');
      const mortas = campo(m, 'mortas');
      const inteiroNaoNegativo = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
      return inteiroNaoNegativo(total) && inteiroNaoNegativo(mortas) && mortas <= total ? null : invalido;
    },
  ],
  [
    'custo.medicao',
    (o) => {
      const papel = campo(o, 'papel');
      const modelo = campo(o, 'modelo');
      return primeiro(
        papel === undefined || typeof papel === 'string' ? null : 'campo `papel` inválido: esperado texto',
        modelo === undefined || modelo === null || typeof modelo === 'string' ? null : 'campo `modelo` inválido: esperado texto ou null',
      );
    },
  ],
]);

/**
 * Motivo pelo qual `dados` não tem a forma do tipo, ou `null` (forma ok, ou tipo sem regra). Total: nunca lança.
 * `dados` ausente ⇒ "dados ausente"; `dados` que não é objeto ⇒ "dados corrompido".
 */
export function formaInvalida(tipo: string, dados: unknown): string | null {
  try {
    if (typeof tipo !== 'string') return null;
    const opcional = REGRAS_OPCIONAIS.get(tipo);
    if (opcional !== undefined) return ehObjeto(dados) ? opcional(dados) : null;
    const regra = REGRAS.get(tipo);
    if (regra === undefined) return null;
    if (dados === undefined) return `${tipo}: dados ausente`;
    if (!ehObjeto(dados)) return `${tipo}: dados corrompido (não é um objeto)`;
    const motivo = regra(dados);
    return motivo === null ? null : `${tipo}: ${motivo}`;
  } catch (e) {
    return `${typeof tipo === 'string' ? tipo : 'evento'}: dados corrompido (ilegível: ${e instanceof Error ? e.message : 'erro desconhecido'})`;
  }
}

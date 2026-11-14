/**
 * Origem de cada fato, normalização de nomes e regex técnica (GM-14, REQ-LNG-1). Núcleo puro: sem I/O, sem relógio.
 * Consumidores: `perguntas`/`trilha`/painel (T12, T17) pelo `dist/origem.js`. Decisões que valem aqui:
 *  - A tabela de origem é FECHADA por tipo explícito (não por prefixo): tipo novo ou inventado ⇒ `null`, nunca `(automático)`.
 *  - ID de entrega (`GM-14`) NUNCA passa por `nomeNatural` (DP-4): o ID cru não casa a regex técnica e `nomeNatural` o estragaria.
 *  - Tudo é total e falha fechada: entrada malformada ⇒ `null` (origem) ou `true` (linha técnica), nunca lança.
 */
                                         
import { formaInvalida, MOTIVOS_PARAR, TIPOS_EVENTO } from './formas.js';

export const REGEX_TECNICA         = /[`]|--|\/[a-z]|\bnode\b|\.(json|mjs|md)\b|[a-z]+_[a-z_]+|[a-z]+\.[a-z]+\b/;

const AUTOMATICO = '(automático)';
const ORQUESTRADOR = '(anotado pelo orquestrador)';
const VOCE = '(você)';
/** GM-14 T36 (FIEL-15, furo 8): a liberação da Sombra não é do dono nem automática. */
const SOMBRA = '(Sombra)';

/** `(automático)`: `fato.medido`, `task.*`, `review.veredito`, `ci.resultado`, `entrega.*`, `sessao.*` (os tipos do contrato, um a um). */
const AUTOMATICOS                      = new Set([
  'fato.medido', 'review.veredito', 'ci.resultado',
  'task.iniciada', 'task.concluida', 'task.integrada', 'task.reaberta',
  'entrega.inicio', 'entrega.smoke', 'entrega.rollback', 'entrega.fim', 'entrega.agendada', 'entrega.devolvida',
  'sessao.inicio', 'sessao.pouso', 'sessao.pouso.tentativa', 'sessao.retomada',
]);

/** Tabela fechada de origem; `dono.mensagem` e tipo fora dela ⇒ `null` (não aparecem). */
export function origemDe(ev        )                {
  if (ev === null || typeof ev !== 'object') return null;
  const tipo = ev.tipo           ;
  if (typeof tipo !== 'string') return null;
  const dados = ev.dados           ;
  if (tipo === 'task.reaberta') {
    const origem = dados !== null && typeof dados === 'object' ? (dados                           ).origem : undefined;
    return origem === 'dono' ? VOCE : origem === 'sombra' ? SOMBRA : AUTOMATICO;
  }
  if (AUTOMATICOS.has(tipo)) return AUTOMATICO;
  if (tipo === 'nota' || tipo === 'decisao.sombra' || tipo === 'spec.aplicada') return ORQUESTRADOR;
  if (tipo === 'spec.aprovada') return VOCE;
  if (tipo === 'dono.resposta') {
    // Só a forma por opção tem rótulo; digitada (`{sha256, chars}`) e qualquer forma inválida não têm origem exibível (falha fechada).
    if (formaInvalida('dono.resposta', dados) !== null) return null;
    const rotulo = (dados                           ).rotulo;
    return typeof rotulo === 'string' ? `(você respondeu: ${rotulo})` : null;
  }
  return null;
}

const escapar = (s        )         => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Tipo de `TipoEvento` ou `MotivoParar` como palavra inteira (letras, dígitos e `_` não encostam), em qualquer caixa (`Smoke`, `NOTA`). */
const PALAVRA_DE_TIPO         = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${[...new Set        ([...TIPOS_EVENTO, ...MOTIVOS_PARAR])].map(escapar).join('|')})(?![\\p{L}\\p{N}_])`, 'iu');

/**
 * Identificador com ponto e camelCase (`loop.tetoTokens`): a regex literal não pega (`\b` falha entre `o` e `T`, medido), o plano exige `true`.
 * Complemento de `linhaTecnica`, sem mexer no literal; consistente com `nomeNatural`, que já troca todo ponto antes de letra.
 */
const PONTO_ENTRE_LETRAS         = /[A-Za-z]\.[A-Za-z]/;

/** `true` se a linha não é linguagem natural: casa `REGEX_TECNICA`, tem ponto entre letras ou contém tipo de evento/motivo de parada como palavra. Não-texto ⇒ `true`. */
export function linhaTecnica(texto        )          {
  if (typeof texto !== 'string') return true;
  return REGEX_TECNICA.test(texto) || PONTO_ENTRE_LETRAS.test(texto) || PALAVRA_DE_TIPO.test(texto);
}

/** Nome de projeto legível: `_` e `-` ⇒ espaço; `.` ⇒ espaço só antes de letra (preserva `2.1.0`, DP-4); espaços colapsados e aparados. Não use em ID de entrega. */
export function nomeNatural(nome        )         {
  if (typeof nome !== 'string') return '';
  return nome.replace(/[_-]/g, ' ').replace(/\.(?=[A-Za-z])/g, ' ').replace(/\s+/g, ' ').trim();
}

/** `'gabarito-mestre--v2.0.0'` ⇒ `'2.0.0'`: o 1º `X.Y.Z` que não faz parte de número com mais partes; sem ele ⇒ `null`. */
export function tagNatural(tag        )                {
  if (typeof tag !== 'string') return null;
  const m = /(?<![0-9.])(\d+\.\d+\.\d+)(?!\d|\.\d)/.exec(tag);
  return m === null ? null : m[1];
}

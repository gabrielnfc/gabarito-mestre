/**
 * Chat em linguagem natural (GM-14 T5, REQ-CHT-1): o mod responde `ui.render` de `ToolGroup` com 1 linha ("consultou 3 arquivos, executou 1 comando").
 * Adaptador fino: a decisão do texto está em `gates/dist/ferramentas.js` (`linhaDoGrupo`); aqui só se lê o grupo e a preferência.
 *
 * `next(e)` (o motor desenha o grupo) quando: o grupo está expandido (ctrl+o, --verbose); `isCallsOnly === false` (o grupo carrega outras linhas: memória,
 * tempo de hook); a preferência é `cru`; a preferência está corrompida ou o store nega (preferência desconhecida ⇒ o desenho do motor, que nunca esconde nada);
 * `linhaDoGrupo` devolve `null` (outra ferramenta, erro, entrada torta); qualquer exceção. Preferência AUSENTE ⇒ natural (padrão).
 *
 * LIMITE DECLARADO (S2b, t0a.md): uma chamada isolada chega como `ToolGroup` de 1 (o site `ToolUse` disparou 0 vezes em 6 medições), por isso este módulo NÃO
 * registra `ToolUse`. Só `Read` solo foi medido; Bash, Edit e Agent solo são presumidos. Medição em emulação pyte, sem terminal real.
 * Sem `node:*`, sem `import()` (o runner do mod só importa arquivos relativos).
 */
import { linhaDoGrupo } from '../gates/dist/ferramentas.js';

export const CHAVE_CHAT = 'chat:prefs';
export const USO_CHAT = 'uso: /gabarito chat cru|natural';

let avisada = null; // valor corrompido já avisado (JSON), para não repetir a cada render

const ehObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Preferência: `'natural'` (padrão, ausente) ou `'cru'` (escolhida, corrompida ou store que nega). Nunca lança. */
async function modoDoChat($) {
  let v;
  try {
    v = await $.store.get(CHAVE_CHAT);
  } catch {
    return 'cru';
  }
  if (v === undefined) return 'natural';
  if (ehObj(v) && (v.modo === 'natural' || v.modo === 'cru') && Object.keys(v).length === 1) return v.modo;
  let marca;
  try { marca = JSON.stringify(v); } catch { marca = '?'; }
  if (avisada !== marca) {
    avisada = marca;
    try { $.ui.log('gabarito: a preferência do chat estava corrompida; uso as linhas cruas. /gabarito chat natural corrige.', { to: 'transcript' }); } catch { /* sem transcript */ }
  }
  return 'cru';
}

const papelDe = (input) => (ehObj(input) && typeof input.subagent_type === 'string' ? input.subagent_type : undefined);

function chamadasDe(calls) {
  if (!Array.isArray(calls) || calls.length === 0) return null;
  const cs = [];
  for (const c of calls) {
    if (!ehObj(c)) return null;
    cs.push({ nome: typeof c.tool === 'string' ? c.tool : '', erro: c.isErrored === true || c.isInterrupted === true, papel: papelDe(c.input) });
  }
  return cs;
}

export function registrarChat(on) {
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    try {
      const p = e?.props;
      if (!ehObj(p) || p.isExpanded === true || p.isCallsOnly === false) return next(e);
      const cs = chamadasDe(p.calls);
      if (cs === null) return next(e);
      const linha = linhaDoGrupo(cs);
      if (linha === null) return next(e);
      if ((await modoDoChat($)) !== 'natural') return next(e);
      const { Text } = $.ui.resolve(e);
      return h(Text, { color: 'inactive' }, linha);
    } catch {
      return next(e);
    }
  });
}

/** `/gabarito chat cru|natural` (`partes` = o que vem depois de `chat`). 1 linha. Nunca lança. */
export async function comandoChat($, partes) {
  try {
    const p = Array.isArray(partes) ? partes.filter((x) => typeof x === 'string' && x !== '') : [];
    const modo = p.length === 1 ? p[0].toLowerCase() : '';
    if (modo !== 'cru' && modo !== 'natural') return USO_CHAT;
    try {
      await $.store.set(CHAVE_CHAT, { modo });
    } catch {
      return 'chat: não consegui gravar a preferência; nada mudou.';
    }
    try { $.ui.invalidate('ui.render'); } catch { /* sem tela */ }
    return modo === 'cru' ? 'chat: linhas cruas, como o Claude Code desenha.' : 'chat: linhas em linguagem natural.';
  } catch {
    return 'chat: erro inesperado';
  }
}

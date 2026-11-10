/**
 * Mod só de teste (GM-10 T13). Registra, em $OBS_DIR/mod.jsonl, a ordem dos eventos e números: nunca texto de prompt,
 * de resposta ou de ferramenta. Não decide nada: toda chamada termina em `next(e)`.
 * O arquivo é reescrito por inteiro a cada evento (`$.fs.write` não anexa), por uma cadeia de promessas.
 */
let dir = null;
let buf = [];
let cadeia = Promise.resolve();
let ultimoLista = '';

const log = ($, o) => {
  cadeia = cadeia.then(async () => {
    if (dir === null) return;
    const t = await $.clock.now();
    let iso = null;
    try { iso = new Date().toISOString(); } catch { /* sem Date no host */ } // mesma chamada do mod (negadoAte): formato a comparar com o `ts` do diário
    buf.push(JSON.stringify({ t, iso, ...o }));
    await $.fs.write(`${dir}/mod.jsonl`, `${buf.join('\n')}\n`);
  }).catch(() => {});
  return cadeia;
};

const agentes = async ($) => {
  try { return (await $.agent.list()).map((a) => ({ id: String(a.id).slice(0, 8), st: a.status, tipo: a.type })); } catch (err) { return [{ erro: String(err).slice(0, 80) }]; }
};

const contexto = async ($) => {
  try { const u = (await $.session.usage()).context; return { tokens: u?.tokens ?? null, percent: u?.percent ?? null, janela: u?.window ?? null }; } catch { return { tokens: null, percent: null, janela: null }; }
};

export const register = (on) => {
  on('session.start', async ($, e, next) => {
    try { dir = (await $.env.get('OBS_DIR')) ?? null; } catch { dir = null; }
    await log($, { ev: 'session.start', interativo: e.isInteractive === true });
    try {
      $.clock.every(3000, async () => {
        const l = await agentes($);
        const chave = JSON.stringify(l.map((a) => [a.id, a.st]));
        if (chave !== ultimoLista) { ultimoLista = chave; await log($, { ev: 'agentes', lista: l }); }
      });
      // Marcador de pouso (`.harness/pouso-pendente.json`, escrito pelo mod com $.fs.write): vive poucos segundos, por isso 500 ms; só a mudança é gravada.
      let raiz = null;
      try { raiz = (await $.session.repo())?.root ?? (await $.session.root()); } catch { raiz = null; }
      if (raiz !== null) {
        let ultimoMarcador = null;
        $.clock.every(500, async () => {
          let existe = null;
          try { existe = (await $.fs.exists(`${raiz}/.harness/pouso-pendente.json`)) === true; } catch { existe = null; }
          if (existe !== ultimoMarcador) { ultimoMarcador = existe; await log($, { ev: 'pendente', existe }); }
        });
      }
    } catch { /* sem relógio: o resto segue */ }
    return next(e);
  });
  on('session.end', async ($, e, next) => { await log($, { ev: 'session.end', reason: e.reason }); return next(e); });
  on('prompt.submit', async ($, e, next) => {
    await log($, { ev: 'prompt.submit', origem: e.origin?.kind ?? null, chars: typeof e.text === 'string' ? e.text.length : null });
    return next(e);
  });
  on('command.run', async ($, e, next) => {
    await log($, { ev: 'command.run', comando: e.command, args: typeof e.args === 'string' ? e.args.slice(0, 40) : null, origem: e.origin?.kind ?? e.origin ?? null });
    return next(e);
  });
  on('ui.close', async ($, e, next) => { await log($, { ev: 'ui.close', id: e?.id ?? null, origem: e?.origin?.kind ?? null }); return next(e); });
  // T14 r2: altura que o motor dá ao corpo da Pane (props.scroll.bodyRows); só números, só quando muda
  let ultimoRender = '';
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    const chave = JSON.stringify([e.requestId ?? null, e.props?.scroll?.bodyRows ?? null, e.props?.bodyColumns ?? null]);
    if (chave !== ultimoRender) { ultimoRender = chave; await log($, { ev: 'pane.render', id: e.requestId ?? null, bodyRows: e.props?.scroll?.bodyRows ?? null, bodyColumns: e.props?.bodyColumns ?? null, offset: e.props?.scroll?.offset ?? null }); }
    return next(e);
  });
  on('tool.call', async ($, e, next) => {
    const sub = e.agentId !== undefined;
    const ctx = sub ? null : await contexto($);
    const ehAgent = e.tool === 'Agent';
    const antes = ehAgent ? await agentes($) : undefined;
    const r = await next(e);
    const negado = r !== null && typeof r === 'object' && typeof r.deny === 'string';
    await log($, {
      ev: 'tool.call', tool: e.tool, agente: sub ? String(e.agentId).slice(0, 8) : null, subagent_type: ehAgent ? (e.subagent_type ?? null) : undefined,
      background: ehAgent ? (e.run_in_background ?? null) : undefined, percent: ctx?.percent ?? null, tokens: ctx?.tokens ?? null,
      negado, motivo: negado ? r.deny.slice(0, 160) : undefined, agentes: antes,
    });
    return r;
  });
  on('turn.complete', async ($, e, next) => {
    const r = await next(e);
    const sub = e.agentId !== undefined;
    await log($, {
      ev: 'turn.complete', agente: sub ? String(e.agentId).slice(0, 8) : null, reason: e.reason, abortado: e.isAborted ?? null,
      uso: e.usage ?? null, ctx: sub ? null : await contexto($), agentes: await agentes($),
    });
    return r;
  });
};

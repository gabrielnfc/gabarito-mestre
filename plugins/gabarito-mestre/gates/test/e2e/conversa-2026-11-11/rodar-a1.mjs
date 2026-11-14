#!/usr/bin/env node
/**
 * Runner do aceite A1 da GM-14 (T24): a conversa real de 2026-11-11, refeita. FORA de `npm test` (abre TUI real do Claude Code e gasta tokens);
 * só as partes puras (forma do `pontos.json`, guarda das falas, asserções sobre a evidência) são importadas por `test/conversa-pontos.test.mjs`.
 *
 *   rodar-a1.mjs --guarda  [--roteiro <arq>]         confere o roteiro (ausente ou sha diferente ⇒ não roda e diz por quê) e que nenhuma fala (≥ 20 caracteres) está em `git ls-files`
 *   rodar-a1.mjs --gerar   [--roteiro <arq>]         regrava `pontos.json`: {msg, sha256, chars} por ponto e o `esperado` GERADO PELO PRODUTO (nunca copiado do roteiro)
 *   rodar-a1.mjs --matriz  [--so <local-tamanho-cheia>] [--paralelo <n>] [--ignorar-ref <regex>]... [--roteiro <arq>]   as 8 execuções (local × tamanho × tela cheia) com `a1.exp`; passa = 8/8; células sob TMPDIR (fora do checkout real); `--paralelo` padrão 1
 *   rodar-a1.mjs avaliar <rundir> [--roteiro <arq>]   a avaliação da matriz sobre uma execução já gravada (offline, não abre claude)
 *   rodar-a1.mjs snapshot <repo> <rundir> <n>        (chamado pelo `a1.exp`) grava o `estado` do produto no ponto n
 *
 * As falas NUNCA vão ao repositório: `pontos.json` guarda só o número da mensagem no roteiro, o sha256 e o tamanho. As falas do roteiro só existem em
 * `.superpowers/` (fora do git) e, durante uma execução, em `<rundir>/falas.tsv` (sob `.claude-tmp/`, ignorado).
 *
 * LIMITE DECLARADO: o A1 completo exige sessões interativas reais do Claude Code (8 × ~62 mensagens). Este runner as dirige por `a1.exp`, mas o ambiente que
 * escreveu o código não as abriu: o que nele toca o TUI (`a1.exp`, o observador de Pane, a leitura do transcript) é presumido até a 1ª execução real (T25).
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const PLUGIN = resolve(AQUI, '..', '..', '..', '..');
const GATES = join(PLUGIN, 'gates');
export const PONTOS_ARQ = join(AQUI, 'pontos.json');
export const ROTEIRO_REL = '.superpowers/sdd/2026-11-11-proxima/roteiro-s4.md';
export const BASE_SHA = 'ba3986fcab009a7c523c420c8c3c0dcb3fab8395';
export const MIN_FALA = 20;

export const sha256 = (t) => createHash('sha256').update(t, 'utf8').digest('hex');
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=a1@example.invalid', '-c', 'user.name=Aceite A1', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Raiz do checkout PRINCIPAL (o roteiro e o `.claude-tmp/` vivem nela, não na worktree). */
export function raizPrincipal(cwd = process.cwd()) {
  const comum = git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim();
  return dirname(comum);
}

// ─── pontos.json: forma ───

export const CHAVES_PONTOS = Object.freeze(['roteiroSha256', 'pontos']);
export const CHAVES_PONTO = Object.freeze(['msg', 'sha256', 'chars', 'esperado']);
export const CHAVES_ESPERADO = Object.freeze(['fase', 'progresso', 'depende', 'origens']);
/** A linha de decisão da Sombra no RECENTE do produto: `[RECENTE · ]HH:MM ● <sabio> decidiu: …`. */
export const LINHA_DECISAO = /^(?:RECENTE · |\s+)\d{2}:\d{2} ● .+ decidiu: /;
export const TOTAL_PONTOS = 26; // roteiro-s4.md "Total de pontos (exceto —): 26"
const HEX64 = /^[0-9a-f]{64}$/;
const mesmas = (o, chaves) => Object.keys(o).length === chaves.length && chaves.every((c) => Object.hasOwn(o, c));
const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Erros da forma de `pontos.json` (lista vazia = válido). Chave a mais (ex. `fala`, `texto`) é erro: o texto do dono nunca entra no arquivo. */
export function validarPontos(p) {
  const erros = [];
  if (!obj(p)) return ['raiz não é objeto'];
  if (!mesmas(p, CHAVES_PONTOS)) erros.push(`chaves da raiz: ${Object.keys(p).join(',')} (permitidas: ${CHAVES_PONTOS.join(',')})`);
  if (typeof p.roteiroSha256 !== 'string' || !HEX64.test(p.roteiroSha256)) erros.push('roteiroSha256 não é sha256 hex de 64');
  if (!Array.isArray(p.pontos)) return [...erros, 'pontos não é lista'];
  if (p.pontos.length !== TOTAL_PONTOS) erros.push(`${p.pontos.length} pontos (esperado ${TOTAL_PONTOS})`);
  const vistos = new Set();
  p.pontos.forEach((x, i) => {
    const r = `pontos[${i}]`;
    if (!obj(x)) { erros.push(`${r} não é objeto`); return; }
    if (!mesmas(x, CHAVES_PONTO)) erros.push(`${r}: chaves ${Object.keys(x).join(',')} (permitidas: ${CHAVES_PONTO.join(',')})`);
    if (!Number.isInteger(x.msg) || x.msg < 1) erros.push(`${r}.msg não é inteiro ≥ 1 (é o número da mensagem no roteiro, nunca a fala)`);
    else if (vistos.has(x.msg)) erros.push(`${r}.msg repetido (${x.msg})`);
    else vistos.add(x.msg);
    if (typeof x.sha256 !== 'string' || !HEX64.test(x.sha256)) erros.push(`${r}.sha256 não é sha256 hex de 64`);
    if (!Number.isInteger(x.chars) || x.chars < 1) erros.push(`${r}.chars não é inteiro ≥ 1`);
    const e = x.esperado;
    if (!obj(e)) { erros.push(`${r}.esperado não é objeto`); return; }
    if (!mesmas(e, CHAVES_ESPERADO)) erros.push(`${r}.esperado: chaves ${Object.keys(e).join(',')} (permitidas: ${CHAVES_ESPERADO.join(',')})`);
    if (e.fase !== null && !(Number.isInteger(e.fase) && e.fase >= 1 && e.fase <= 7)) erros.push(`${r}.esperado.fase não é 1..7 nem null`);
    if (typeof e.progresso !== 'string') erros.push(`${r}.esperado.progresso não é texto`);
    for (const c of ['depende', 'origens']) if (!Array.isArray(e[c]) || e[c].some((s) => typeof s !== 'string')) erros.push(`${r}.esperado.${c} não é lista de texto`);
  });
  return erros;
}

// ─── roteiro e guarda das falas ───

/** Linhas da tabela do roteiro (`| # | hora | mensagem | ponto? | por quê |`): `{n, hora, texto, rotulo, porque}`. */
export function falasDoRoteiro(conteudo) {
  const falas = [];
  for (const linha of conteudo.split('\n')) {
    const m = /^\| (\d+) \| (\d\d:\d\d:\d\d) \| (.*) \| (—|[A-ZÇÃÕ ]+) \| (.*) \|$/u.exec(linha);
    if (m !== null) falas.push({ n: Number(m[1]), hora: m[2], texto: m[3], rotulo: m[4], porque: m[5] });
  }
  return falas;
}

/** `{ok:true, conteudo, sha256, falas}` ou `{ok:false, motivo}` (roteiro ausente, ilegível ou com sha diferente do de `pontos.json`). */
export function verificarRoteiro(caminho, roteiroSha256) {
  if (!existsSync(caminho)) return { ok: false, motivo: `roteiro ausente: ${caminho} (fica fora do git; sem ele o A1 não roda)` };
  let conteudo;
  try { conteudo = readFileSync(caminho, 'utf8'); } catch (e) { return { ok: false, motivo: `roteiro ilegível: ${caminho} (${e.code ?? 'erro'})` }; }
  const sha = sha256(conteudo);
  if (sha !== roteiroSha256) return { ok: false, motivo: `roteiro com sha256 diferente do de pontos.json (${sha.slice(0, 12)}… ≠ ${String(roteiroSha256).slice(0, 12)}…): o roteiro mudou, regrave com --gerar` };
  return { ok: true, conteudo, sha256: sha, falas: falasDoRoteiro(conteudo) };
}

/**
 * A guarda das falas: nenhuma fala (≥ `min` caracteres) do roteiro em arquivo de `git ls-files` de `raiz`. Devolve `{ok, achados:[{arquivo, n}], arquivos}`.
 * Arquivo binário (byte NUL) ou acima de 4 MB não é lido e conta em `ignorados`. Lista que o git não entrega ⇒ lança (a guarda nunca passa no escuro).
 */
export function guardaFalas(raiz, falas, { min = MIN_FALA } = {}) {
  const lista = execFileSync('git', ['ls-files', '-z'], { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
  const alvos = falas.filter((f) => [...f.texto].length >= min);
  const achados = [];
  let ignorados = 0;
  for (const arquivo of lista) {
    const p = join(raiz, arquivo);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (!st.isFile()) continue;
    if (st.size > 4 * 1024 * 1024) { ignorados += 1; continue; }
    const buf = readFileSync(p);
    if (buf.includes(0)) { ignorados += 1; continue; }
    const t = buf.toString('utf8');
    for (const f of alvos) if (t.includes(f.texto)) achados.push({ arquivo, n: f.n });
  }
  return { ok: achados.length === 0, achados, arquivos: lista.length, ignorados, conferidas: alvos.length };
}

// ─── a matriz do A1 ───

/** 8 execuções = local × tamanho × tela cheia (spec, Aceite A1 r4). */
export const MATRIZ = Object.freeze(
  ['lateral', 'acima'].flatMap((local) => [{ cols: 80, rows: 24 }, { cols: 180, rows: 50 }].flatMap((t) => [true, false].map((cheia) => Object.freeze({ local, ...t, cheia })))),
);
export const idDaCelula = (c) => `${c.local}-${c.cols}x${c.rows}-${c.cheia ? 'cheia' : 'normal'}`;

/** Asserção 12: `lateral` ⇒ `dock` só em tela cheia com ≥ 110 colunas, `inline` nas outras; `acima` ⇒ 0 Pane (`null`). */
export function placementEsperado(c) {
  if (c.local === 'acima') return null;
  return c.cheia === true && c.cols >= 110 ? 'dock' : 'inline';
}

// ─── as asserções do A1 (12 da spec; a 8 são 6) sobre a evidência de UMA execução ───

const EMOJI = /[\p{Extended_Pictographic}\uFE0F]/u;
const BLOCOS = [['depende', /^(depende de você|PAROU|◆ DEPENDE)/], ['fase', /^(PRONTO|FASE) /], ['agora', /^AGORA ·/], ['atencao', /^ATENÇÃO ·/], ['recente', /^RECENTE ·/]];
/** Blocos presentes em um quadro, na ordem de aparição. */
export function blocosDe(linhas) {
  const achados = [];
  for (const l of linhas) for (const [nome, re] of BLOCOS) if (re.test(l) && !achados.includes(nome)) achados.push(nome);
  return achados;
}
const ORDEM_CORTE = ['depende', 'fase', 'agora', 'atencao', 'recente'];
const res = (ok, detalhe) => ({ ok, detalhe });
/** Pelo menos um ponto da execução com agente vivo observado; sem isso as asserções de vivo não têm o que medir (nunca passam em vácuo). */
/**
 * Linha-resumo do AGORA que o PRODUTO desenha quando a reserva da Sombra não cabe (GM-14 T42, emenda 37): `  <N> agentes: <rótulo> <task> · <rótulo> <task> …`.
 * Devolve `{ n, itens: [{ rotulo, task }], truncada }` ou `null` se o quadro não tem a forma compacta (a forma cheia, 1 linha por agente, segue medida como antes).
 */
export function resumoDoAgora(linhas) {
  const l = (Array.isArray(linhas) ? linhas : []).find((x) => /^\s+\d+ agentes:( |$)/.test(x));
  if (l === undefined) return null;
  const m = /^\s+(\d+) agentes:\s*(.*)$/.exec(l);
  const truncada = / …$/.test(m[2]);
  const corpo = m[2].replace(/ …$/, '');
  const itens = corpo === '' ? [] : corpo.split(' · ').map((it) => { const i = it.indexOf(' '); return i < 0 ? { rotulo: it, task: '' } : { rotulo: it.slice(0, i), task: it.slice(i + 1) }; });
  return { n: Number(m[1]), itens, truncada };
}
/** Na forma compacta, os agentes visíveis (antes do "…"): rótulo e task iguais aos do AGORA do estado, na ordem; itens além dos agentes são segundo plano (`Teste`). */
const visiveisBatem = (p) => p.resumo.itens.slice(0, p.detalhes.length).every((it, i) => it.rotulo === p.detalhes[i].nome && it.task === p.detalhes[i].task && it.rotulo !== '' && it.task !== '');
const vivoObservado = (ev) => Array.isArray(ev.vivos) && ev.vivos.some((p) => p.ativos > 0);

export const ASSERCOES = Object.freeze([
  { id: '1-depende-no-topo', ref: 'A1 (1)', avaliar: (ev) => {
    // o cabeçalho "GABARITO · <entrega>" pode abrir o quadro; o DEPENDE vem antes de qualquer outro bloco e, havendo item, nunca falta (nada cortado do topo)
    const ruins = ev.quadros.filter((q) => {
      const ls = q.linhas.filter((l) => !/^GABARITO ·/.test(l));
      const i = ls.findIndex((l) => BLOCOS[0][1].test(l));
      if (q.itensDepende > 0 && i !== 0) return true;
      return i > 0;
    });
    if (ev.quadrosSemProps !== 0) return res(false, `${ev.quadrosSemProps} pontos sem as props da superfície observadas (bodyRows/maxRows): não medida`);
    return res(ev.quadros.length > 0 && ruins.length === 0, `${ev.quadros.length} quadros, ${ruins.length} com o DEPENDE fora do topo ou cortado`);
  } },
  { id: '2-blocos-e-corte', ref: 'A1 (2)', avaliar: (ev) => {
    const { cols, rows } = ev.celula;
    if (ev.quadrosSemProps !== 0) return res(false, `${ev.quadrosSemProps} pontos sem as props da superfície observadas (bodyRows/maxRows): não medida`);
    const cheio = ev.quadros.reduce((m, q) => (blocosDe(q.linhas).length > blocosDe(m?.linhas ?? []).length ? q : m), null);
    if (cheio === null) return res(false, 'sem quadro');
    const presentes = blocosDe(cheio.linhas);
    if (cols === 80 && rows === 24) {
      // blocos 1–3 presentes e o RECENTE é o primeiro a sair: o que sobra é prefixo da ordem de corte
      // exceção declarada (emenda 32/37): o RECENTE pode voltar como 1 linha só, a decisão da Sombra reservada, depois do ATENÇÃO sair (D-P8, 1ª e 2ª exceções)
      const recLinhas = cheio.linhas.filter((l) => /^(RECENTE ·|  \d\d:\d\d )/.test(l));
      const reservada = presentes[presentes.length - 1] === 'recente' && recLinhas.length === 1 && LINHA_DECISAO.test(recLinhas[0]);
      const base = reservada ? presentes.slice(0, -1) : presentes;
      const prefixo = base.every((b, i) => b === ORDEM_CORTE[i]);
      const tres = ORDEM_CORTE.slice(0, 3).every((b) => presentes.includes(b));
      return res(tres && prefixo, `blocos ${presentes.join(',')}`);
    }
    const cap = ev.celula.local === 'acima' ? 2 : 5;
    const rec = cheio.linhas.filter((l) => /^(RECENTE ·|  \d\d:\d\d )/.test(l));
    const comOrigem = rec.every((l) => /\([^)]+\)\s*$/.test(l));
    return res(ORDEM_CORTE.every((b) => presentes.includes(b)) && rec.length >= 1 && rec.length <= cap && comOrigem, `blocos ${presentes.join(',')}; RECENTE ${rec.length} (teto ${cap}); com origem ${comOrigem}`);
  } },
  { id: '3-sem-task-integrada', ref: 'A1 (3)', avaliar: (ev) => {
    if (ev.quadros.length === 0) return res(false, 'sem quadro observado: não medida');
    if (ev.integradas.length === 0) return res(false, 'nenhuma task integrada no diário: não medida');
    const linhas = ev.quadros.flatMap((q) => q.linhas).filter((l) => !/^(RECENTE ·|PRONTO |FASE |GABARITO ·)/.test(l) && !/^  \d\d:\d\d /.test(l));
    const ruins = linhas.filter((l) => ev.integradas.some((id) => new RegExp(`(?<![A-Za-z0-9])${id}(?![A-Za-z0-9])`).test(l)));
    return res(ruins.length === 0, `${ruins.length} linhas citam task integrada fora do RECENTE e do PRONTO`);
  } },
  { id: '4-agora-ativos', ref: 'A1 (4)', avaliar: (ev) => {
    if (!vivoObservado(ev)) return res(false, 'nenhum agente vivo observado em nenhum ponto: não medida');
    // forma compacta (emenda 37, só com a reserva da Sombra): a ação e o tempo saem; vale rótulo e task de cada agente visível antes do "…"; nomes únicos (FIEL-3 d) seguem
    const ruins = ev.vivos.filter((p) => {
      const nomes = p.detalhes.map((v) => v.nome);
      const unicos = new Set(nomes).size === nomes.length;
      return p.resumo != null ? !(visiveisBatem(p) && unicos) : !(p.detalhes.every((v) => v.nome && v.task && v.acao) && unicos);
    });
    const compactos = ev.vivos.filter((p) => p.resumo != null).length;
    return res(ruins.length === 0, `${ev.vivos.length} pontos (${compactos} na linha-resumo), ${ruins.length} com vivo sem nome/task/ação ou nome repetido`);
  } },
  { id: '5-sem-emoji', ref: 'A1 (5)', avaliar: (ev) => {
    const textos = [...ev.quadros.flatMap((q) => q.linhas), ...ev.transcript.textos];
    const ruins = textos.filter((t) => EMOJI.test(t));
    return res(textos.length > 0 && ruins.length === 0, `${ruins.length} textos com emoji de ${textos.length}`);
  } },
  { id: '6-assunto-vira-pergunta', ref: 'A1 (6)', avaliar: (ev) => {
    const assuntos = ev.perguntas.filter((p) => p.rotulo === 'MUDANÇA DE ASSUNTO');
    const ruins = assuntos.filter((p) => !(p.abriuPergunta === true && p.botoes === true));
    return res(assuntos.length > 0 && ruins.length === 0, `${assuntos.length} mudanças de assunto, ${ruins.length} sem pergunta com botões`);
  } },
  { id: '7-sem-edit-em-harness-nem-status-a-mao', ref: 'A1 (7)', avaliar: (ev) => {
    if (ev.transcript.chamadas.length === 0) return res(false, 'nenhuma chamada de ferramenta no transcript: não medida');
    const edits = ev.transcript.chamadas.filter((c) => (c.nome === 'Edit' || c.nome === 'Write') && String(c.entrada?.file_path ?? '').includes('/.harness/'));
    const aMao = ev.transcript.textos.filter((t) => /^(GABARITO ·|FASE \d de 7|PRONTO [▰▱])/m.test(t));
    return res(edits.length === 0 && aMao.length === 0, `${edits.length} Edit/Write em .harness/; ${aMao.length} blocos de status à mão`);
  } },
  { id: '8a-dono-mensagem-sem-duplicata', ref: 'A1 (8) Emenda 1', avaliar: (ev) => {
    const por = new Map();
    for (const e of ev.eventos) if (e.tipo === 'dono.mensagem') por.set(e.dados.sha256, (por.get(e.dados.sha256) ?? 0) + 1);
    if (por.size === 0) return res(false, 'nenhum dono.mensagem gravado no diário: não medida');
    if (ev.digitadas.length === 0) return res(false, 'nenhuma fala digitada registrada: não medida');
    const digitadas = new Map();
    for (const s of ev.digitadas) digitadas.set(s, (digitadas.get(s) ?? 0) + 1);
    const ruins = [...por].filter(([sha, n]) => n > (digitadas.get(sha) ?? 0));
    return res(ruins.length === 0, `${ruins.length} textos gravados mais vezes do que digitados`);
  } },
  { id: '8b-agent-nao-negado-em-status', ref: 'A1 (8) Emenda 1', avaliar: (ev) => {
    // o turno de status vem do transcript (a última fala digitada antes da chamada ↔ o roteiro); sem nenhuma chamada em turno de status a asserção não mediu nada
    const emStatus = ev.transcript.chamadas.filter((c) => c.nome === 'Agent' && c.turnoDeStatus === true);
    const ruins = emStatus.filter((c) => c.negada === true);
    return res(emStatus.length >= 1 && ruins.length === 0, `${emStatus.length} Agent em turno de pergunta de status, ${ruins.length} negados`);
  } },
  { id: '8c-nada-em-entrega-publicada', ref: 'A1 (8) Emenda 1', avaliar: (ev) => {
    // publicada = o critério do PRODUTO (FIEL-1 b: último `fato.medido pr` mergeado e nenhum aberto, medido antes do início; `publicadaPeloProduto`); sem nenhuma, a asserção não mediu nada
    const ruins = ev.entregasPublicadas.filter((id) => (ev.gravacoes[id]?.depois ?? 0) !== (ev.gravacoes[id]?.antes ?? 0));
    return res(ev.entregasPublicadas.length >= 1 && ruins.length === 0, `${ev.entregasPublicadas.length} entregas publicadas vigiadas, ${ruins.length} com gravação nova`);
  } },
  { id: '8d-vivo-com-nome-descricao-task', ref: 'A1 (8) Emenda 1', avaliar: (ev) => {
    if (!vivoObservado(ev)) return res(false, 'nenhum agente vivo observado em nenhum ponto: não medida');
    // forma compacta: a descrição sai (declarado, emenda 37); vale rótulo e task dos visíveis antes do "…" (os escondidos ficam cobertos pela 8e)
    const ruins = ev.vivos.flatMap((p) => (p.resumo != null ? (visiveisBatem(p) ? [] : [p]) : p.detalhes.filter((v) => !(v.nome && v.descricao && v.task))));
    return res(ruins.length === 0, `${ruins.length} vivos sem nome, descrição ou task em ${ev.vivos.length} pontos`);
  } },
  { id: '8e-vivos-igual-linhas-de-agente', ref: 'A1 (8) Emenda 1', avaliar: (ev) => {
    if (!vivoObservado(ev)) return res(false, 'nenhum agente vivo observado em nenhum ponto: não medida');
    // forma compacta: "N agentes" = número de vivos (inclui os que o "…" esconde), numa linha só (emenda 37)
    const ruins = ev.vivos.filter((p) => (p.resumo != null ? p.resumo.n !== p.ativos : p.ativos !== p.linhasAgente));
    return res(ruins.length === 0, `${ruins.length} de ${ev.vivos.length} pontos com ativos ≠ linhas de agente (${ruins.map((p) => `${p.ativos}/${p.resumo != null ? p.resumo.n : p.linhasAgente}`).join(' ')})`);
  } },
  { id: '8f-sombra-decisao-visivel', ref: 'A1 (8) Emenda 1', avaliar: (ev) => {
    // a decisão que o PRODUTO desenha no RECENTE é `<sabio> decidiu: …` (painel.ts:592); a ATENÇÃO "N consultas à Sombra sem decisão registrada" (painel.ts:683) NÃO é decisão
    const decisoes = ev.eventos.filter((e) => e.tipo === 'decisao.sombra' && typeof e.dados?.resposta === 'string' && e.dados.resposta.trim() !== '').length;
    if (decisoes === 0) return res(false, 'nenhuma decisão da Sombra registrada no diário: não medida');
    const visiveis = ev.quadros.flatMap((q) => q.linhas).filter((l) => LINHA_DECISAO.test(l)).length;
    return res(visiveis >= 1, `${decisoes} decisões da Sombra registradas, ${visiveis} linhas de decisão no RECENTE`);
  } },
  { id: '9-veredito-com-revisor-antes', ref: 'A1 (9)', avaliar: (ev) => {
    const armado = new Set();
    let ruins = 0;
    for (const e of ev.eventos) {
      const task = e.dados?.task;
      if (e.tipo === 'task.iniciada' && e.dados?.papel === 'revisor') armado.add(task);
      if (e.tipo === 'review.veredito') { if (!armado.has(task)) ruins += 1; armado.delete(task); }
    }
    const vereditos = ev.eventos.filter((e) => e.tipo === 'review.veredito').length;
    if (vereditos === 0) return res(false, 'nenhum review.veredito no diário: não medida');
    return res(ruins === 0, `${ruins} de ${vereditos} vereditos sem revisor iniciado antes no ciclo`);
  } },
  { id: '10-despachos-com-aprendizados', ref: 'A1 (10)', avaliar: (ev) => {
    // `aprendizados` de cada despacho vêm do `proxima` que o orquestrador leu antes (tool_result no transcript); sem nenhum item com aprendizado observado, não mediu nada
    const comRegra = ev.despachos.filter((d) => d.aprendizados.length > 0);
    const ruins = ev.despachos.filter((d) => d.aprendizados.some((r) => !d.prompt.includes(r)));
    return res(comRegra.length >= 1 && ruins.length === 0, `${ev.despachos.length} despachos, ${comRegra.length} com aprendizados observados no proxima, ${ruins.length} sem eles no prompt`);
  } },
  { id: '11-pouso-a-50', ref: 'A1 (11)', avaliar: (ev) => {
    const p = ev.pouso;
    return res(p.percent >= 50 && p.limparNoDepende === true && p.pushes === 1 && p.despachosDepois === 0, `pouso a ${p.percent} %; "limpar a conversa" no DEPENDE ${p.limparNoDepende}; ${p.pushes} push; ${p.despachosDepois} despachos antes do /clear`);
  } },
  { id: '12-placement-da-pane', ref: 'A1 (12)', avaliar: (ev) => {
    const esperado = placementEsperado(ev.celula);
    const vistos = ev.panes.map((p) => p.placement);
    const dbg = Array.isArray(ev.placementsDebug) ? ev.placementsDebug : [];
    // as duas fontes da plataforma: `$.ui.panes()` (observador) e o `ui.open … placed|waits unplaced` do debug.log; sem leitura da plataforma nada foi medido
    if (ev.panesObservadas !== true) return res(false, 'a plataforma nunca devolveu a lista de panes ao observador: não medida');
    if (esperado === null) return res(vistos.length === 0 && dbg.length === 0, `placement esperado null (acima); lido ${JSON.stringify(vistos)}; ui.open no debug.log ${dbg.length}`);
    if (dbg.length === 0) return res(false, 'sem "ui.open … placed" no debug.log: não medida');
    const unplaced = dbg.filter((d) => d.estado === 'unplaced');
    if (unplaced.length > 0) return res(false, `a plataforma registrou unplaced em ${unplaced.map((d) => `${d.colunas} colunas`).join(', ')} (placement esperado ${esperado})`);
    if (vistos.length === 0) return res(false, `a plataforma disse placed, mas $.ui.panes() não devolveu placement (esperado ${esperado}): placement não lido`);
    return res(vistos.length === 1 && vistos[0] === esperado, `placement esperado ${esperado}; lido ${JSON.stringify(vistos)}; debug.log placed`);
  } },
]);

/** Uma execução passa só com TODAS as asserções. Asserção que lança reprova (nunca vira "não se aplica"). */
export function avaliarExecucao(ev) {
  const resultados = ASSERCOES.map((a) => {
    let r;
    try { r = a.avaliar(ev); } catch (e) { r = res(false, `evidência malformada: ${String(e.message ?? e).slice(0, 80)}`); }
    return { id: a.id, ref: a.ref, ok: r.ok === true, detalhe: r.detalhe };
  });
  return { celula: idDaCelula(ev.celula), passa: resultados.every((r) => r.ok), resultados };
}

/** Passa = 8/8 células distintas da matriz, cada uma passando; célula que falta ou que a plataforma não desenhou conta como falha. */
export function avaliarMatriz(execucoes) {
  const por = new Map(execucoes.map((x) => [x.celula, x]));
  const linhas = MATRIZ.map((c) => { const id = idDaCelula(c); const x = por.get(id); return { celula: id, passa: x?.passa === true, motivo: x === undefined ? 'não executada' : x.passa ? '' : x.resultados.filter((r) => !r.ok).map((r) => r.id).join(',') }; });
  const passaram = linhas.filter((l) => l.passa).length;
  return { passou: passaram, total: MATRIZ.length, ok: passaram === MATRIZ.length, linhas };
}

// ─── execução real (presumida até a 1ª sessão interativa; ver LIMITE no topo) ───

const BIN_GH = join(AQUI, 'gh-fixture');
const PONTO_TIPO = { 'MUDANÇA DE ASSUNTO': 'assunto', 'IDEIA NOVA': 'ideia' };

function ambienteDe(extra = {}) {
  const e = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_') && !k.startsWith('NODE_TEST') && k !== 'NODE_OPTIONS') e[k] = v;
  return { ...e, ...extra };
}

/** Cópia do repo na base do A1, com identidade git definida, `gh` de fixture e config de local e de tela cheia. */
export function prepararCopia(raiz, destino, celula) {
  if (existsSync(destino)) throw new Error(`destino já existe: ${destino}`);
  execFileSync('git', ['clone', '-q', '--no-hardlinks', raiz, destino], { stdio: ['ignore', 'pipe', 'pipe'] });
  git(destino, 'checkout', '-q', BASE_SHA);
  git(destino, 'config', 'user.name', 'Aceite A1');
  git(destino, 'config', 'user.email', 'a1@example.invalid');
  git(destino, 'checkout', '-q', '-B', 'enabler/GM-13-a1');
  // `origin` da cópia = um bare local com `post-receive` que conta os pushes (asserção 11); nunca o repositório de origem da clonagem
  const bare = join(destino, '..', 'origin.git');
  git(destino, 'remote', 'remove', 'origin');
  execFileSync('git', ['init', '-q', '--bare', bare], { stdio: ['ignore', 'pipe', 'pipe'] });
  writeFileSync(join(bare, 'hooks', 'post-receive'), `#!/bin/sh\necho push >> "${join(destino, '..', 'pushes.log')}"\n`);
  chmodSync(join(bare, 'hooks', 'post-receive'), 0o755);
  git(destino, 'remote', 'add', 'origin', bare);
  const bin = join(destino, '..', 'bin');
  mkdirSync(bin, { recursive: true });
  copyFileSync(join(BIN_GH, 'gh'), join(bin, 'gh'));
  chmodSync(join(bin, 'gh'), 0o755);
  copyFileSync(join(BIN_GH, 'estado.json'), join(destino, '..', 'gh.json'));
  const cfg = JSON.parse(readFileSync(join(destino, 'harness.config.json'), 'utf8'));
  cfg.painel = { ...(cfg.painel ?? {}), local: celula.local };
  writeFileSync(join(destino, 'harness.config.json'), `${JSON.stringify(cfg, null, 2)}\n`);
  mkdirSync(join(destino, '.claude'), { recursive: true });
  writeFileSync(join(destino, '.claude', 'settings.local.json'), `${JSON.stringify({ tui: celula.cheia ? 'fullscreen' : 'default' })}\n`);
  semear(destino, bin, join(destino, '..', 'gh.json'));
  return { bin, gh: join(destino, '..', 'gh.json') };
}

/** Regra sintética (D, entra no brief do implementador) semeada na cópia: sem ela o `proxima` não traz aprendizado e a asserção 10 nada mediria. */
export const REGRA_SEMENTE = 'Regra de semente do A1: confirme o escopo de arquivos antes de escrever.';

/**
 * Entrega JÁ PUBLICADA como na conversa real (F19): a da branch da cópia (`idDaBranch('enabler/GM-13-a1')` = GM-13, com o `plano.json` da `ba3986f` como 2º fato) com o PR #14
 * mergeado e a release 2.0.0, gravados como `fato.medido` (`gh`) pelo `append` do próprio produto, `ts` antigo. É o que faz o produto reconhecer a entrega como publicada (FIEL-1 b).
 */
export function semearEntregaPublicada(destino) {
  const script = `import { append } from ${JSON.stringify(pathToFileURL(join(GATES, 'dist', 'diario.js')).href)};
const dir = process.argv[1];
for (const [chave, valor] of [['pr', { numero: 14, estado: 'mergeado', branch: 'enabler/GM-13-a1' }], ['release', { tag: 'v2.0.0' }]]) {
  const r = append(dir, 'semente', { ts: '2026-11-10T12:00:00.000Z', autor: 'a1@example.invalid', sessao: 'semente', agente: 'painel', tipo: 'fato.medido', dados: { chave, fonte: 'gh', valor } });
  if (!r.ok) { process.stderr.write(r.erro); process.exit(1); }
}`;
  const a = spawnSync(process.execPath, ['--input-type=module', '-e', script, join(destino, '.harness', 'entregas', 'GM-13')], { cwd: destino, encoding: 'utf8' });
  if (a.status !== 0) throw new Error(`semente da entrega publicada: ${a.stderr}${a.stdout}`);
}

/**
 * Publicada pelo critério do PRODUTO: pergunta a `trilhaDe` (dist/trilha.js) com a branch `enabler/<id>-a1`, o plano da `ba3986f` como 2º fato e `gh: ok`; com o 2º fato presente, a branch sozinha NÃO identifica a entrega só quando o último PR está mergeado e nenhum aberto (FIEL-1 b): `identificada === false` com `candidato === id` ⇒ publicada.
 * Não reimplementa `prs` (privada em trilha.ts). Só vale o diário até `inicio` (o que a execução gravar não conta); diário que o produto não ordena ⇒ fase PR `?` ⇒ identificada ⇒ não publicada.
 */
export async function publicadaPeloProduto(eventos, inicio, id = 'GM-13') {
  const { trilhaDe } = await import(pathToFileURL(join(GATES, 'dist', 'trilha.js')).href);
  const ate = eventos.filter((e) => e.ts <= inicio);
  const t = trilhaDe({ branch: `enabler/${id}-a1`, idPadrao: '[A-Z]+-\\d+', specs: [], plano: { tasks: [] }, ledger: false, gh: 'ok', ultimas: [] }, ate);
  return t.identificada === false && t.candidato === id;
}

/**
 * Semeia a cópia com o que as asserções 8c e 10 precisam para medir algo: (a) uma entrega JÁ PUBLICADA (`semearEntregaPublicada`) para vigiar "nada gravado em entrega publicada";
 * (b) um aprendizado D no brief do implementador, gravado pelo CLI do produto.
 */
export function semear(destino, bin, ghEstado) {
  semearEntregaPublicada(destino);
  const b = spawnSync(process.execPath, [join(GATES, 'scripts', 'loop.mjs'), 'aprendizado', 'E', 'D', '--regra', REGRA_SEMENTE, '--entra-em', 'brief:implementador', '--fonte', 'README.md', '--numero', '1', '--sessao', 'S-semente'], { cwd: destino, encoding: 'utf8', env: ambienteDe({ PATH: `${bin}:${process.env.PATH}`, GH_FIXTURE: ghEstado }) });
  if (b.status !== 0) throw new Error(`semente do aprendizado: ${b.stdout}${b.stderr}`);
}

/** Mod só de teste: registra em `$OBS_DIR/a1.jsonl` o que a plataforma entrega ao mod do painel, sem texto de prompt: a lista de agentes e as Panes (`placement`), os nomes que o mod guardou (`painel:nomes`), cada `tool.call` de subagente e as props de cada superfície (`Pane`: `scroll.bodyRows`/`bodyColumns`; `AbovePrompt`: `maxRows`/`viewport.rows`/`bodyColumns`). Este plugin entra ANTES do mod na linha de comando para ver o render antes de o mod o consumir. */
export function escreverObservador(destino) {
  mkdirSync(join(destino, '.claude-plugin'), { recursive: true });
  mkdirSync(join(destino, 'hooks'), { recursive: true });
  writeFileSync(join(destino, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'observador-a1', version: '0.0.1', description: 'Observador do A1 (GM-14 T24): agentes, placement das Panes, props das superfícies e ações dos subagentes.' })}\n`);
  writeFileSync(join(destino, 'hooks', 'hooks.json'), `${JSON.stringify({ modules: ['../register.mjs'] })}\n`);
  writeFileSync(join(destino, 'register.mjs'), `let dir = null; const buf = []; let cadeia = Promise.resolve(); let ultimo = ''; const gravado = {}; const pendente = {};
const log = ($, o) => { cadeia = cadeia.then(async () => { if (dir === null) return; buf.push(JSON.stringify({ t: await $.clock.now(), ...o })); await $.fs.write(dir + '/a1.jsonl', buf.join('\\n') + '\\n'); }).catch(() => {}); return cadeia; };
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const escalares = (p) => Object.fromEntries(Object.entries(p ?? {}).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v) || v === null));
// T49 (b): render que chega ANTES de o session.start saber onde gravar fica pendente (nunca vira "último render"); só o último GRAVADO deduplica
const render = ($, comp, o) => { if (dir === null) { pendente[comp] = o; return; } const chave = JSON.stringify(o); if (gravado[comp] === chave) return; gravado[comp] = chave; void log($, { ev: 'render', comp, ...o }); };
export const register = (on) => {
  on('session.start', async ($, e, next) => {
    try { dir = (await $.env.get('OBS_DIR')) ?? null; } catch { dir = null; }
    for (const [comp, o] of Object.entries(pendente)) { delete pendente[comp]; render($, comp, o); }
    try {
      $.clock.every(3000, async () => {
        let agentes = []; let panes = []; let nomes = null;
        try { agentes = (await $.agent.list()).map((a) => ({ id: String(a.id), type: a.type ?? null, status: a.status ?? null, description: a.description ?? null })); } catch { agentes = null; }
        try { panes = (await $.ui.panes()).map((p) => ({ id: String(p.id ?? ''), placement: p.placement ?? null, raw: escalares(p) })); } catch { panes = null; }
        try { nomes = (await $.store.get('painel:nomes')) ?? null; } catch { nomes = null; }
        const chave = JSON.stringify([agentes, panes, nomes]);
        if (chave !== ultimo) { ultimo = chave; await log($, { ev: 'estado', agentes, panes, nomes }); }
      });
    } catch { /* sem relógio */ }
    return next(e);
  });
  on('tool.call', async ($, e, next) => {
    try { if (typeof e?.agentId === 'string') await log($, { ev: 'tool', agentId: e.agentId, tool: e.tool ?? null, subagent_type: e.subagent_type ?? null, description: e.tool === 'Bash' && typeof e.description === 'string' ? e.description : null }); } catch { /* observador nunca derruba a chamada */ }
    return next(e);
  });
  on('ui.render', { component: 'Pane', requestId: 'gabarito-painel' }, async ($, e, next) => {
    try { render($, 'Pane', { bodyRows: num(e.props?.scroll?.bodyRows), bodyColumns: num(e.props?.bodyColumns) }); } catch { /* idem */ }
    return next(e);
  });
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try { render($, 'AbovePrompt', { maxRows: num(e.props?.maxRows), rows: num(e.viewport?.rows), bodyColumns: num(e.props?.bodyColumns), hasSurvey: e.props?.hasSurvey === true }); } catch { /* idem */ }
    return next(e);
  });
};
`);
}

/** Roda o `estado` do produto na cópia e devolve o JSON. Falha ⇒ lança (nunca vira estado vazio). */
export function estadoDoProduto(repo, { entrada = null, bin = null, ghEstado = null } = {}) {
  const env = ambienteDe({ ...(bin === null ? {} : { PATH: `${bin}:${process.env.PATH}` }), ...(ghEstado === null ? {} : { GH_FIXTURE: ghEstado }) });
  const r = spawnSync(process.execPath, [join(GATES, 'scripts', 'painel.mjs'), 'estado', ...(entrada === null ? [] : ['--agentes'])], { cwd: repo, encoding: 'utf8', env, input: entrada ?? undefined, timeout: 60_000 });
  if (r.status !== 0) throw new Error(`painel estado: rc ${r.status} ${r.stdout.slice(0, 200)} ${r.stderr.slice(0, 200)}`);
  return JSON.parse(r.stdout).estado;
}

/** O `esperado` de um estado: só o que o produto diz (fase, progresso, motivos do DEPENDE, origens do RECENTE). */
export function esperadoDe(estado) {
  const fase = estado?.fase?.numero ?? estado?.trilha?.fase ?? null;
  const progresso = String(estado?.fase?.progresso ?? estado?.trilha?.progresso ?? '');
  const depende = (Array.isArray(estado?.depende) ? estado.depende : []).map((i) => String(i.motivo));
  const origens = (Array.isArray(estado?.recente) ? estado.recente : []).map((r) => String(r.origem ?? '')).filter(Boolean);
  return { fase: Number.isInteger(fase) ? fase : null, progresso, depende, origens };
}

/** `--gerar`: percorre os pontos em ordem numa cópia nova, grava `dono.mensagem {sha256, chars}` (como o mod) e a nota do tipo do ponto, lê o estado do produto. */
export function gerar(fonte, tmpRaiz, roteiro, saida = PONTOS_ARQ) {
  const base = join(tmpRaiz, '.claude-tmp', 'a1-gerar');
  const stamp = String(Date.now());
  const destino = join(base, stamp, 'repo');
  mkdirSync(join(base, stamp), { recursive: true });
  const { bin, gh } = prepararCopia(fonte, destino, { local: 'lateral', cols: 180, rows: 50, cheia: true });
  const loop = (...a) => spawnSync(process.execPath, [join(GATES, 'scripts', 'loop.mjs'), ...a], { cwd: destino, encoding: 'utf8', env: ambienteDe({ PATH: `${bin}:${process.env.PATH}`, GH_FIXTURE: gh }) });
  const pontos = [];
  for (const f of roteiro.falas.filter((x) => x.rotulo !== '—')) {
    const tipo = PONTO_TIPO[f.rotulo];
    if (tipo !== undefined) {
      const r = loop('anotar', '--tipo', tipo, '--texto', `ponto ${f.n} do roteiro`, '--sessao', 'S-a1');
      if (r.status !== 0) throw new Error(`anotar ponto ${f.n}: ${r.stdout} ${r.stderr}`);
    }
    pontos.push({ msg: f.n, sha256: sha256(f.texto), chars: [...f.texto].length, esperado: esperadoDe(estadoDoProduto(destino, { bin, ghEstado: gh })) });
  }
  const dados = { roteiroSha256: roteiro.sha256, pontos };
  const erros = validarPontos(dados);
  if (erros.length > 0) throw new Error(`pontos.json gerado inválido: ${erros.join('; ')}`);
  // nenhuma string ≥ 20 caracteres do arquivo está no roteiro
  const vazadas = JSON.stringify(dados, null, 2).split('"').filter((s) => [...s].length >= MIN_FALA && roteiro.conteudo.includes(s));
  if (vazadas.length > 0) throw new Error(`pontos.json gerado repete texto do roteiro (${vazadas.length} strings): recusado`);
  writeFileSync(saida, `${JSON.stringify(dados, null, 2)}\n`);
  return { pontos: pontos.length, destino };
}

function jsonl(arq) {
  return existsSync(arq) ? readFileSync(arq, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
}

const TERMINAIS = new Set(['completed', 'failed', 'killed']);
const ATIVOS = new Set(['pending', 'running', 'waiting']);

/**
 * `acoes` do stdin como o mod as guarda (mod/painel.mjs `anotarAcao`): a última ferramenta de cada subagente (`tool.call` com `agentId`), pela `acaoDe` do núcleo,
 * com a contagem de chamadas seguidas do mesmo tipo; `Bash` com descrição ⇒ a descrição (fonte `bash`); agente terminal perde a ação. `ferr` = `dist/ferramentas.js`.
 */
export function acoesDe(tools, agentes, ferr) {
  const acoes = {}; const base = new Map();
  for (const t of tools) {
    if (typeof t.agentId !== 'string' || t.agentId === '') continue;
    const chamada = { nome: t.tool, erro: false, papel: t.subagent_type ?? undefined, descricao: t.tool === 'Bash' ? t.description ?? undefined : undefined };
    const b = ferr.acaoDe(chamada, 1);
    if (b === null) continue;
    const bash = t.tool === 'Bash' && ferr.descricaoLimpa(t.description) !== null;
    const ant = base.get(t.agentId);
    const n = bash ? 1 : ant !== undefined && ant.base === b ? ant.n + 1 : 1;
    base.set(t.agentId, { base: bash ? null : b, n });
    const texto = ferr.acaoDe(chamada, n);
    if (texto !== null) acoes[t.agentId] = { texto, fonte: bash ? 'bash' : 'tool', em: Math.max(0, Math.round(Number(t.t) || 0)) };
  }
  for (const a of Array.isArray(agentes) ? agentes : []) if (TERMINAIS.has(a.status)) delete acoes[a.id];
  return acoes;
}

/** stdin do `estado --agentes` no mesmo contrato que o mod envia (`pedidoDoMod`): agentes, `nomes` (o `painel:nomes` do mod), `acoes`, `encerrados`, `segundoPlano`. */
export function entradaDoSnapshot(obs, ferr) {
  const ultimo = obs.filter((e) => e.ev === 'estado').at(-1);
  const agentes = (ultimo?.agentes ?? []).map((a) => ({ id: a.id, type: a.type ?? '', description: a.description ?? '', status: a.status ?? '', transcript: null }));
  const ids = new Set(agentes.map((a) => a.id));
  const nomes = {};
  for (const [id, v] of Object.entries(ultimo?.nomes ?? {})) if (ids.has(id) && v !== null && typeof v === 'object') nomes[id] = v;
  const acoes = acoesDe(obs.filter((e) => e.ev === 'tool'), agentes, ferr);
  const encerrados = agentes.filter((a) => TERMINAIS.has(a.status)).map((a) => a.id);
  return { agentes, panes: ultimo?.panes ?? [], entrada: { session_id: 'S-a1', sessao: { percent: null }, agentes, nomes, acoes, encerrados, segundoPlano: [] } };
}

/** Props da última renderização de cada superfície (`Pane`, `AbovePrompt`) vista até aqui; superfície nunca vista ⇒ ausente. */
export function propsDe(obs) {
  const props = {};
  for (const e of obs) if (e.ev === 'render' && typeof e.comp === 'string') { const { ev: _ev, comp, t: _t, ...resto } = e; props[comp] = resto; }
  return props;
}

/** Subcomando `snapshot` (chamado pelo `a1.exp` depois de cada ponto): guarda o `estado` do produto, os agentes vistos e as props das superfícies naquele instante. */
export async function snapshot(repo, rundir, n) {
  const obs = jsonl(join(rundir, 'obs', 'a1.jsonl'));
  // invariante do 1º snapshot (T49): sem render da superfície da célula observado, nada será medido: para a célula aqui e agora
  const celula = celulaDoRundir(rundir);
  if (celula !== null && !(existsSync(join(rundir, 'estados')) && readdirSync(join(rundir, 'estados')).length > 0)) {
    const causa = invariantePrimeiroSnapshot(obs, celula);
    if (causa !== null) { writeFileSync(join(rundir, 'abortar.txt'), `${causa}\n`, { flag: 'a' }); return; }
  }
  const ferr = await import(pathToFileURL(join(GATES, 'dist', 'ferramentas.js')).href);
  const { agentes, entrada } = entradaDoSnapshot(obs, ferr);
  const estado = estadoDoProduto(repo, { entrada: JSON.stringify(entrada), bin: join(repo, '..', 'bin'), ghEstado: join(repo, '..', 'gh.json') });
  mkdirSync(join(rundir, 'estados'), { recursive: true });
  writeFileSync(join(rundir, 'estados', `${String(n).padStart(2, '0')}.json`), `${JSON.stringify({ n, props: propsDe(obs), agentes, estado })}\n`);
}

let modCache = null;
const carregarMod = async () => (modCache ??= await import(pathToFileURL(join(PLUGIN, 'mod', 'painel.mjs')).href));
const larguraDe = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1); // a mesma do mod (`larguraDe`)

/**
 * O quadro como o MOD o desenha: as funções do próprio `mod/painel.mjs` (`linhasDaPane` + `orcamentoLateral` na lateral; `linhasDaFaixa` em `acima`) com as props que o
 * observador leu da plataforma. Superfície sem render observado ⇒ `null` (a asserção reprova como "não medida"; nada é inventado).
 */
export async function renderizar(estado, props, celula) {
  const mod = await carregarMod();
  const prefs = { ...mod.PREFS_PADRAO, tema: 'mono' };
  const texto = (linhas) => linhas.map((l) => l.map((s) => s.texto).join('')).filter((l) => l !== '');
  if (celula.local === 'acima') {
    const p = props?.AbovePrompt;
    if (p === undefined || p === null) return null;
    return texto(mod.linhasDaFaixa(estado, prefs, { largura: larguraDe(p.bodyColumns), h: p.rows ?? undefined, maxRows: p.maxRows ?? undefined }));
  }
  const p = props?.Pane;
  if (p === undefined || p === null) return null;
  const bodyRows = p.bodyRows ?? undefined;
  const novo = estado !== null && typeof estado === 'object' && typeof estado.modo === 'string';
  let linhas = mod.linhasDaPane(novo ? mod.estadoParaDesenho(estado) : estado, prefs, larguraDe(p.bodyColumns), { altura: bodyRows, orcamento: mod.orcamentoLateral(bodyRows), local: 'lateral' });
  if (novo) linhas = linhas.slice(0, mod.orcamentoLateral(bodyRows));
  return texto(linhas);
}

const textoDe = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text).join('') : '');

/** Itens `{papel, aprendizados:[…]}` de uma saída de `loop.mjs proxima` (qualquer profundidade). Saída que não é JSON ⇒ []. */
export function itensDeProxima(saida) {
  let o;
  try { o = JSON.parse(saida); } catch { return []; }
  const itens = [];
  const anda = (v) => {
    if (Array.isArray(v)) { v.forEach(anda); return; }
    if (v === null || typeof v !== 'object') return;
    if (Array.isArray(v.aprendizados)) itens.push({ papel: typeof v.papel === 'string' ? v.papel : null, aprendizados: v.aprendizados.filter((r) => typeof r === 'string') });
    Object.values(v).forEach(anda);
  };
  anda(o);
  return itens;
}

/**
 * Transcripts de uma execução ⇒ `{chamadas, textos, despachos}`. `turnoDeStatus`: a última fala digitada antes da chamada (sha256 ↔ roteiro) é pergunta de status
 * (`porque` do roteiro). `negada`: o `tool_result` da chamada veio com `is_error`. `despachos[].aprendizados`: as regras dos itens do último `loop.mjs proxima`
 * cujo papel está no `subagent_type` (sem papel que case, todos os itens).
 */
export function lerTranscripts(pasta, falas) {
  const porSha = new Map(falas.map((f) => [sha256(f.texto), f]));
  const chamadas = []; const textos = []; const despachos = [];
  if (!existsSync(pasta)) return { chamadas, textos, despachos };
  for (const f of readdirSync(pasta).filter((x) => x.endsWith('.jsonl'))) {
    const linhas = jsonl(join(pasta, f));
    const negadas = new Set();
    for (const l of linhas) for (const b of Array.isArray(l.message?.content) ? l.message.content : []) if (b.type === 'tool_result' && b.is_error === true) negadas.add(b.tool_use_id);
    let fala = null; let itens = []; const bashProxima = new Set();
    for (const l of linhas) {
      const c = l.message?.content;
      if (l.type === 'user') {
        const t = textoDe(c);
        if (typeof c === 'string' || (Array.isArray(c) && c.some((b) => b?.type === 'text'))) fala = porSha.get(sha256(t)) ?? porSha.get(sha256(t.trim())) ?? null;
        for (const b of Array.isArray(c) ? c : []) if (b.type === 'tool_result' && bashProxima.has(b.tool_use_id)) itens = itensDeProxima(textoDe(b.content));
      }
      for (const b of Array.isArray(c) ? c : []) {
        if (l.type === 'assistant' && b.type === 'text') textos.push(b.text);
        if (l.type === 'assistant' && b.type === 'tool_use') {
          chamadas.push({ nome: b.name, entrada: b.input, negada: negadas.has(b.id), turnoDeStatus: fala !== null && /pergunta de status/i.test(fala.porque ?? ''), ts: l.timestamp ?? null });
          if (b.name === 'Bash' && /loop\.mjs['"]?\s+proxima\b/.test(String(b.input?.command ?? ''))) bashProxima.add(b.id);
          if (b.name === 'Agent') {
            const tipo = String(b.input?.subagent_type ?? '');
            const casam = itens.filter((i) => i.papel !== null && tipo.includes(i.papel));
            despachos.push({ papel: tipo || null, prompt: String(b.input?.prompt ?? ''), aprendizados: (casam.length > 0 ? casam : itens).flatMap((i) => i.aprendizados) });
          }
        }
      }
    }
  }
  return { chamadas, textos, despachos };
}

/** Pasta dos transcripts do Claude Code para o repo (`<config>/projects/<caminho com tudo que não é [A-Za-z0-9-] trocado por ->`). */
export const pastaDeTranscripts = (repo) => join(configDaConta(), 'projects', realpathSync(repo).replace(/[^A-Za-z0-9-]/g, '-'));

/** Junta a evidência de uma execução (diário, observador, snapshots, transcripts) no formato que `avaliarExecucao` espera. `pasta`: transcripts (padrão: a do Claude Code para o repo). */
export async function coletar(rundir, repo, celula, roteiro, { pasta = null, total = TOTAL_PONTOS } = {}) {
  const dirs = join(repo, '.harness', 'entregas');
  const eventos = [];
  const gravacoes = {};
  const publicadas = new Set();
  const inicio = existsSync(join(rundir, 'inicio.iso')) ? readFileSync(join(rundir, 'inicio.iso'), 'utf8').trim() : '';
  if (existsSync(dirs)) {
    for (const d of readdirSync(dirs)) {
      // linha ilegível reprova a execução (não some)
      for (const a of readdirSync(join(dirs, d)).filter((x) => /^events\..+\.jsonl$/.test(x))) {
        const linhas = readFileSync(join(dirs, d, a), 'utf8').split('\n').filter(Boolean);
        for (const l of linhas) { try { eventos.push({ ...JSON.parse(l), _entrega: d }); } catch { throw new Error(`diário ilegível: ${d}/${a}`); } }
      }
      const dele = eventos.filter((e) => e._entrega === d);
      // 8c (emenda 38): o `fato.medido` do painel (âncora e medições da pergunta (b), FIEL-1 b/c) fica no diário da branch e não conta; qualquer outro evento novo conta
      const conta = (e) => !(e.tipo === 'fato.medido' && e.autor === 'painel');
      gravacoes[d] = { antes: dele.filter((e) => conta(e) && e.ts <= inicio).length, depois: dele.filter(conta).length };
      // publicada = o critério do produto sobre o que foi medido ANTES do início (a semente da cópia); o que a execução medir não vale
      if (await publicadaPeloProduto(dele, inicio, d)) publicadas.add(d);
    }
  }
  const sends = existsSync(join(rundir, 'sends.log')) ? readFileSync(join(rundir, 'sends.log'), 'utf8').split('\n').filter(Boolean) : [];
  const digitadas = sends.map((l) => /^\d+ digitar ([0-9a-f]{64})$/.exec(l)?.[1]).filter(Boolean);
  const obs = jsonl(join(rundir, 'obs', 'a1.jsonl'));
  const ultimo = obs.filter((e) => e.ev === 'estado').at(-1);
  const estadosDir = join(rundir, 'estados');
  const snaps = [];
  if (existsSync(estadosDir)) {
    for (const f of readdirSync(estadosDir).sort()) {
      let s;
      try { s = JSON.parse(readFileSync(join(estadosDir, f), 'utf8')); } catch { throw new Error(`snapshot ilegível: ${f}`); }
      if (s === null || typeof s !== 'object' || s.estado === undefined || !Array.isArray(s.agentes)) throw new Error(`snapshot fora da forma: ${f}`);
      snaps.push(s);
    }
  }
  // snapshot que falhou (a.exp) ou contagem diferente do censo reprova a execução: as asserções por ponto não avaliam o subconjunto que sobrou como se fosse o todo (I1)
  if (existsSync(join(rundir, 'snapshot-falhou.log'))) throw new Error(`snapshot falhou: ${readFileSync(join(rundir, 'snapshot-falhou.log'), 'utf8').trim().split('\n')[0]}`);
  if (snaps.length !== total) throw new Error(`${snaps.length} snapshots (esperado ${total})`);
  const quadros = []; let quadrosSemProps = 0;
  const resumos = new Map(); // ponto → linha-resumo do AGORA que o produto desenhou (emenda 37), ou null
  for (const s of snaps) {
    const linhas = await renderizar(s.estado, s.props, celula);
    resumos.set(s.n, linhas === null ? null : resumoDoAgora(linhas));
    if (linhas === null) { quadrosSemProps += 1; continue; }
    quadros.push({ linhas, itensDepende: (s.estado.depende ?? []).length + (s.estado.pergunta ? 1 : 0) + (s.estado.parar ? 1 : 0) });
  }
  const { chamadas, textos, despachos } = lerTranscripts(pasta ?? pastaDeTranscripts(repo), roteiro.falas);
  const perguntas = snaps.map((s) => ({ ponto: s.n, rotulo: roteiro.falas.find((f) => f.n === s.n)?.rotulo ?? '—', abriuPergunta: s.estado.pergunta != null, botoes: Array.isArray(s.estado.pergunta?.opcoes) && s.estado.pergunta.opcoes.length >= 2 }));
  const integradas = eventos.filter((e) => e.tipo === 'task.integrada').map((e) => e.dados?.task).filter(Boolean);
  // vivos em CADA ponto: os agentes ativos que o observador viu naquele instante × as linhas de agente do AGORA do produto
  const vivos = snaps.map((s) => {
    const agora = Array.isArray(s.estado?.agora?.agentes) ? s.estado.agora.agentes : [];
    const equipe = Array.isArray(s.estado?.equipe?.agentes) ? s.estado.equipe.agentes : [];
    const detalhes = agora.map((l) => { const e = equipe.find((x) => x.nome === l.quem?.nome); return { nome: l.quem?.nome, descricao: e?.descricao, task: l.task ?? e?.task, acao: l.acao ?? null }; });
    return { ativos: s.agentes.filter((a) => ATIVOS.has(a.status)).length, linhasAgente: agora.length, detalhes, resumo: resumos.get(s.n) ?? null };
  });
  // pouso (asserção 11): o `sessao.pouso` do diário, o "limpar a conversa" em algum quadro depois dele, os pushes do bare e os `Agent` entre o pouso e o próximo `sessao.inicio {origem: clear}`
  const pouso = eventos.find((e) => e.tipo === 'sessao.pouso');
  const clear = pouso === undefined ? undefined : eventos.find((e) => e.tipo === 'sessao.inicio' && e.dados?.origem === 'clear' && e.ts > pouso.ts);
  const pushes = existsSync(join(rundir, 'pushes.log')) ? readFileSync(join(rundir, 'pushes.log'), 'utf8').split('\n').filter(Boolean).length : 0;
  const depoisDoPouso = pouso === undefined ? [] : chamadas.filter((c) => c.nome === 'Agent' && c.ts > pouso.ts && (clear === undefined || c.ts < clear.ts));
  return {
    ambiente: dialogosDoExpLog(existsSync(join(rundir, 'exp.log')) ? readFileSync(join(rundir, 'exp.log'), 'utf8') : ''),
    celula, quadros, quadrosSemProps, integradas, eventos, digitadas, transcript: { chamadas, textos }, perguntas, despachos,
    entregasPublicadas: [...publicadas], gravacoes, vivos,
    pouso: { percent: Number.isFinite(pouso?.dados?.percent) ? pouso.dados.percent : 0, limparNoDepende: pouso !== undefined && quadros.some((q) => q.linhas.some((l) => /limpar a conversa/i.test(l))), pushes, despachosDepois: depoisDoPouso.length },
    panes: (ultimo?.panes ?? []).filter((p) => p.placement !== null),
    // as fontes da plataforma para a asserção 12: o observador chegou a ler a lista de panes? e o que o debug.log diz do `ui.open` do painel
    panesObservadas: obs.some((e) => e.ev === 'estado' && Array.isArray(e.panes)),
    placementsDebug: placementsDoDebugLog(existsSync(join(rundir, 'debug.log')) ? readFileSync(join(rundir, 'debug.log'), 'utf8') : ''),
  };
}

// ─── isolamento (T49, emenda 43): a célula e a cópia do plugin vivem FORA do checkout real; o repo real é provado intocado antes e depois ───

/** Condutor do A1 (emenda 43 d): Sonnet; haiku fazia 0–2 `Agent` por célula e não conduzia a conversa. */
export const MODELO_CONDUTOR = 'claude-sonnet-5-5';

export const dentroDe = (pai, filho) => { const p = resolve(pai); const f = resolve(filho); return f === p || f.startsWith(p.endsWith('/') ? p : `${p}/`); };
/** Os textos que citam algum dos caminhos reais (a célula nunca os vê: cwd, `--plugin-dir`, argumentos, falas). */
export const vazamentos = (textos, raizes) => textos.filter((t) => typeof t === 'string' && raizes.some((r) => t.includes(r)));
/** Raiz do checkout real que hospeda este runner (o principal: a worktree vive dentro dele). */
export const raizDoRepoReal = () => realpathSync(raizPrincipal(AQUI));
const realDe = (raizes) => [...new Set(raizes.map((r) => { try { return realpathSync(r); } catch { return resolve(r); } }))];

/** Refs que OUTROS implementadores movem (worktrees `wt/<PBI>-<n>` do próprio loop): não são sinal de a célula ter tocado o repo real. */
export const IGNORAR_REFS_PADRAO = Object.freeze([/^refs\/heads\/wt\//]);
/** Linhas de `git status` que o ORQUESTRADOR vivo move (estado do harness e temporários do projeto): o diário, as consultas da Sombra e `.claude-tmp/` não são arquivo de código tocado pela célula. */
export const IGNORAR_STATUS_PADRAO = Object.freeze([/^.. "?\.harness\//, /^.. "?\.claude-tmp\//]);
/**
 * A foto de um repo: `git status --porcelain`, `for-each-ref` (sem as refs de `ignorarRefs`) e `worktree list` (só os caminhos: o HEAD de uma worktree de outro implementador se move sem a célula).
 * Quem não é repo ⇒ lança (a prova nunca passa no escuro).
 */
export function fotoDoRepo(raiz, { ignorarRefs = IGNORAR_REFS_PADRAO, ignorarStatus = IGNORAR_STATUS_PADRAO } = {}) {
  const g = (...a) => execFileSync('git', ['-C', raiz, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  const refs = g('for-each-ref', '--format=%(refname) %(objectname)').split('\n').filter((l) => l !== '' && !ignorarRefs.some((re) => re.test(l.split(' ')[0]))).join('\n');
  const worktrees = g('worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ') && !/\/\.harness\/worktrees\//.test(l)).join('\n');
  const status = g('status', '--porcelain', '--untracked-files=all').split('\n').filter((l) => l !== '' && !ignorarStatus.some((re) => re.test(l))).join('\n');
  return { status, refs, worktrees };
}
/** Diferenças entre duas fotos (lista vazia = intocado), uma por parte que mudou, com o que mudou. */
export function diferencasDeFotos(antes, depois) {
  const linhas = (t) => new Set(String(t).split('\n').filter(Boolean));
  return ['status', 'refs', 'worktrees'].flatMap((k) => {
    if (antes[k] === depois[k]) return [];
    const a = linhas(antes[k]); const d = linhas(depois[k]);
    const novas = [...d].filter((l) => !a.has(l)); const sumiram = [...a].filter((l) => !d.has(l));
    return [`${k}: +${JSON.stringify(novas.slice(0, 5))} -${JSON.stringify(sumiram.slice(0, 5))}`];
  });
}

/** Cópia do plugin para fora do checkout real (sem `node_modules` nem `.git`): é o `--plugin-dir` do produto na célula. */
export function copiarPlugin(destino) {
  cpSync(PLUGIN, destino, { recursive: true, filter: (o) => !/(^|\/)(node_modules|\.git)(\/|$)/.test(o.slice(PLUGIN.length)) });
}

/**
 * Regras `permissions.deny` que fecham o repo real ao condutor (medido: a célula, sem caminho nenhum no prompt, explorou o disco do usuário, achou `~/projetos_pessoais/<repo>` e criou
 * uma worktree NELE). Caminho absoluto e a forma relativa ao HOME (`~/…`). Spike: `claude -p` com a regra responde DENIED; sem ela executa.
 */
export function regrasDeNegacao(raizes, home = homedir()) {
  const alvos = raizes.flatMap((r) => (dentroDe(home, r) && r !== resolve(home) ? [r, r.slice(resolve(home).length + 1)] : [r]));
  return [...new Set([...alvos.map((a) => `Bash(*${a}*)`), ...raizes.flatMap((r) => ['Read', 'Edit', 'Write', 'Glob', 'Grep'].map((f) => `${f}(/${r}/**)`))])];
}

/** Argumentos do `claude` da célula (o `a1.exp` os lê de `<rundir>/claude.args`, um por linha): só caminhos da cópia, modelo Sonnet. */
export function argvDoClaude({ observador, plugin, superpowers, debugLog, settings }) {
  return ['--plugin-dir', observador, '--plugin-dir', plugin, '--plugin-dir', superpowers, '--settings', settings, '--setting-sources', 'project,local', '--strict-mcp-config',
    '--model', MODELO_CONDUTOR, '--permission-mode', 'auto', '--allowedTools', 'Bash(node *)', 'Read', 'ScheduleWakeup', '--debug-file', debugLog];
}

/** O que a plataforma diz do `ui.open` do painel no debug.log: `{colunas, estado: 'placed'|'unplaced'}` por abertura (única fonte de "placed" que ela expõe). */
export function placementsDoDebugLog(log) {
  const achados = [];
  for (const l of String(log).split('\n')) {
    const m = /ui\.open \S+ gabarito-painel \([^,)]*, (\d+) columns\): (placed|waits unplaced)/.exec(l);
    if (m !== null) achados.push({ colunas: Number(m[1]), estado: m[2] === 'placed' ? 'placed' : 'unplaced' });
  }
  return achados;
}

/** Invariante do 1º snapshot: a superfície da célula (`lateral` ⇒ Pane, `acima` ⇒ AbovePrompt) já tem render observado; senão a célula nada mede. Devolve a causa ou `null`. */
export function invariantePrimeiroSnapshot(obs, celula) {
  const rs = obs.filter((e) => e.ev === 'render');
  if (rs.length === 0) return '0 render observado no 1º snapshot (observador sem nenhum render)';
  const esperada = celula.local === 'acima' ? 'AbovePrompt' : 'Pane';
  return rs.some((e) => e.comp === esperada) ? null : `0 render de ${esperada} no 1º snapshot (a superfície da célula ${celula.local} não foi observada)`;
}

/** `exp.status` do a1.exp que invalida a célula na hora (plugin não ativo, login pedido). */
export function causaDoStatus(texto) {
  const t = String(texto).trim();
  if (t === 'NAO_PROVADO_PLUGIN') return 'plugin gabarito-mestre não ativo na célula (dependência ausente ou não carregou)';
  if (t === 'NAO_PROVADO_LOGIN') return 'login pedido na célula: a conta não está autenticada';
  return null;
}

/** `celula.json` (ou o nome `<local>-<cols>x<rows>-<cheia|normal>` da pasta, como nas execuções antigas) ⇒ célula; senão `null`. */
export function celulaDoRundir(rundir) {
  try { return JSON.parse(readFileSync(join(rundir, 'celula.json'), 'utf8')); } catch { /* cai para o nome */ }
  const m = /(lateral|acima)-(\d+)x(\d+)-(cheia|normal)$/.exec(String(rundir).replace(/\/$/, ''));
  return m === null ? null : { local: m[1], cols: Number(m[2]), rows: Number(m[3]), cheia: m[4] === 'cheia' };
}

/**
 * Roda o `a1.exp` (`expect`) de UMA célula, de forma assíncrona, vigiando as invariantes enquanto roda: o repo real mudou (foto ≠ a de antes) ou apareceu `abortar.txt`
 * (escrito pelo `a1.exp` ou pelo `snapshot`) ⇒ mata o expect na hora e devolve `{status, abortada}`. cwd e PWD = `rundir` (nunca o checkout real).
 */
export function executarExpect({ rundir, args, reais, expect = 'expect', intervalo = 10_000, timeoutMs = 4 * 60 * 60 * 1000, fotoOpc = {} }) {
  return new Promise((ok) => {
    const antes = reais.map((r) => fotoDoRepo(r, fotoOpc));
    const filho = spawn(expect, args, { cwd: rundir, env: ambienteDe({ PWD: rundir }), stdio: 'ignore' });
    let abortada = null; let fim = false;
    const parar = (causa) => {
      if (abortada !== null) return;
      abortada = causa;
      try { writeFileSync(join(rundir, 'abortar.txt'), `${causa}\n`, { flag: 'a' }); } catch { /* rundir some */ }
      try { filho.kill('SIGTERM'); } catch { /* já saiu */ }
      setTimeout(() => { try { filho.kill('SIGKILL'); } catch { /* já saiu */ } }, 3000).unref();
    };
    const vigia = setInterval(() => {
      if (fim || abortada !== null) return;
      if (existsSync(join(rundir, 'abortar.txt'))) { parar(readFileSync(join(rundir, 'abortar.txt'), 'utf8').trim().split('\n')[0] || 'abortar.txt'); return; }
      try {
        const dif = reais.flatMap((r, i) => diferencasDeFotos(antes[i], fotoDoRepo(r, fotoOpc)));
        if (dif.length > 0) parar(`repo real alterado durante a célula: ${dif.join('; ')}`);
      } catch (e) { parar(`repo real ilegível durante a célula: ${String(e.message).slice(0, 120)}`); }
    }, intervalo);
    const teto = setTimeout(() => parar(`teto de ${Math.round(timeoutMs / 60000)} min da célula`), timeoutMs);
    filho.on('close', (status) => {
      fim = true; clearInterval(vigia); clearTimeout(teto);
      const st = existsSync(join(rundir, 'exp.status')) ? causaDoStatus(readFileSync(join(rundir, 'exp.status'), 'utf8')) : null;
      const arq = existsSync(join(rundir, 'abortar.txt')) ? readFileSync(join(rundir, 'abortar.txt'), 'utf8').trim().split('\n')[0] : null;
      ok({ status, abortada: abortada ?? (arq === '' ? null : arq) ?? st });
    });
    filho.on('error', (e) => { fim = true; clearInterval(vigia); clearTimeout(teto); ok({ status: -1, abortada: `expect não abriu: ${e.code ?? e.message}` }); });
  });
}

/** A avaliação de uma execução GRAVADA: a mesma da matriz (coletar + avaliarExecucao). `opc.repo`/`celula`/`roteiro`/`pasta`/`total` têm padrão pela pasta (`<rundir>/repo`, nome/`celula.json`). */
export async function avaliarRundir(rundir, { repo = join(rundir, 'repo'), celula = celulaDoRundir(rundir), roteiro, pasta = null, total = TOTAL_PONTOS } = {}) {
  if (celula === null) throw new Error(`célula desconhecida para ${rundir} (sem celula.json nem nome <local>-<cols>x<rows>-<cheia|normal>)`);
  return avaliarExecucao(await coletar(rundir, repo, celula, roteiro, { pasta, total }));
}

const DEPS = { preparar: (...a) => prepararCopia(...a), copiarPlugin, executar: executarExpect, avaliar: (rundir, repo, celula, roteiro) => avaliarRundir(rundir, { repo, celula, roteiro }), superpowers: () => resolverSuperpowers() };

/**
 * A matriz. `base` fica SOB `TMPDIR` (nunca no checkout real); `opc.paralelo` (padrão 1) limita as células simultâneas; cada célula grava o `resultado.json` ao terminar;
 * invariante violada (repo real alterado, plugin não ativo, 0 render no 1º snapshot, célula fora de `TMPDIR`) reprova a célula e PARA a matriz: as demais não rodam e contam como falha.
 */
export async function matriz(fonte, tmpRaiz, roteiro, so, { paralelo = 1, deps = {}, ignorarRefs = IGNORAR_REFS_PADRAO, ignorarStatus = IGNORAR_STATUS_PADRAO } = {}) {
  const fotoOpc = { ignorarRefs, ignorarStatus };
  const d = { ...DEPS, ...deps };
  const celulas = MATRIZ.filter((c) => so === null || so.split(',').includes(idDaCelula(c)));
  const reais = realDe([fonte, tmpRaiz]);
  const base = join(realpathSync(tmpdir()), 'gabarito-a1', String(Date.now()));
  if (reais.some((r) => dentroDe(r, base))) throw new Error(`a célula ficaria dentro do checkout real (${base}): defina TMPDIR fora dele`);
  const ruins = vazamentos(roteiro.falas.map((f) => f.texto), reais);
  if (ruins.length > 0) throw new Error(`${ruins.length} fala(s) do roteiro com caminho do repo real: a célula não pode vê-lo`);
  const execucoes = [];
  let abortada = null;
  const gravar = (id, rundir, exec, ambiente) => writeFileSync(join(rundir, 'resultado.json'), `${JSON.stringify({ ...exec, ambiente }, null, 2)}\n`);
  const executar = async (celula) => {
    const id = idDaCelula(celula);
    const rundir = join(base, id); const repo = join(rundir, 'repo');
    mkdirSync(join(rundir, 'obs'), { recursive: true });
    const sp = d.superpowers();
    if (!sp.ok) {
      process.stderr.write(`${id}: ${sp.causa}\n`);
      const exec = { celula: id, passa: false, resultados: [{ id: 'dependencia', ok: false, detalhe: sp.causa }] };
      gravar(id, rundir, exec, ambienteDaExecucao('', sp));
      return exec;
    }
    const antes = reais.map((x) => fotoDoRepo(x, fotoOpc));
    const plugin = join(rundir, 'plugin');
    const { bin } = d.preparar(fonte, repo, celula);
    d.copiarPlugin(plugin);
    escreverObservador(join(rundir, 'observador'));
    writeFileSync(join(rundir, 'celula.json'), `${JSON.stringify(celula)}\n`);
    writeFileSync(join(rundir, 'inicio.iso'), `${new Date().toISOString()}\n`);
    writeFileSync(join(rundir, 'falas.tsv'), roteiro.falas.map((f) => `${f.n}\t${f.rotulo}\t${sha256(f.texto)}\t${f.texto}`).join('\n'));
    const settings = join(rundir, 'settings.json');
    writeFileSync(settings, `${JSON.stringify({ permissions: { deny: regrasDeNegacao(reais) } }, null, 2)}\n`);
    const argv = argvDoClaude({ observador: join(rundir, 'observador'), plugin, superpowers: sp.caminho, debugLog: join(rundir, 'debug.log'), settings });
    writeFileSync(join(rundir, 'claude.args'), `${argv.join('\n')}\n`);
    const vaza = vazamentos([rundir, repo, ...argv], reais);
    if (vaza.length > 0) throw new Error(`argumento da célula com caminho do repo real: ${vaza[0]}`);
    const args = ['-f', join(AQUI, 'a1.exp'), rundir, repo, bin, process.execPath, fileURLToPath(import.meta.url)];
    const r = await d.executar({ rundir, repo, plugin, argv, celula: id, args, reais, fotoOpc });
    let dif = [];
    try { dif = reais.flatMap((x, i) => diferencasDeFotos(antes[i], fotoDoRepo(x, fotoOpc))); } catch (e) { dif = [`foto final ilegível: ${e.message}`]; }
    const ambiente = { ...dialogosDoExpLog(existsSync(join(rundir, 'exp.log')) ? readFileSync(join(rundir, 'exp.log'), 'utf8') : ''), superpowers: superpowersNoAmbiente(sp) };
    let exec;
    if (dif.length > 0) {
      exec = { celula: id, passa: false, resultados: [{ id: 'isolamento', ok: false, detalhe: `repo real alterado (célula inválida): ${dif.join('; ')}` }] };
      abortada ??= `isolamento: repo real alterado na célula ${id}`;
    } else if (r.abortada !== null && r.abortada !== undefined) {
      exec = { celula: id, passa: false, resultados: [{ id: 'invariante', ok: false, detalhe: r.abortada }] };
      abortada ??= `invariante violada na célula ${id}: ${r.abortada}`;
    } else {
      let nota = '';
      let exec0 = null;
      try { exec0 = r.status === 0 ? await d.avaliar(rundir, repo, celula, roteiro) : null; if (r.status !== 0) nota = `expect rc ${r.status}`; } catch (e) { nota = `coleta falhou: ${e.message}`; process.stderr.write(`${id}: ${nota}\n`); }
      exec = exec0 ?? { celula: id, passa: false, resultados: [{ id: 'execucao', ok: false, detalhe: `${nota}; evidência ausente` }] };
    }
    gravar(id, rundir, exec, ambiente);
    return exec;
  };
  const fila = [...celulas];
  const trabalhador = async () => {
    for (;;) {
      if (abortada !== null) return;
      const c = fila.shift();
      if (c === undefined) return;
      execucoes.push(await executar(c));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(paralelo, celulas.length || 1)) }, trabalhador));
  return { rel: avaliarMatriz(execucoes), execucoes, base, abortada };
}

// ─── ambiente da execução (T44, emenda 39) ───

/** Carga do plugin gabarito-mestre pelo debug.log do Claude Code. Só o NOSSO plugin conta: dependência de OUTRO plugin ausente (superpowers) não reprova SE o nosso estiver ativo.
 * Sinal positivo obrigatório: o gabarito-mestre aparece entre os plugins HABILITADOS ("Checking plugin gabarito-mestre:" do getPluginSkills). "Loaded inline plugin from path" é só descoberta e o
 * observador-a1 é outro plugin: nenhum dos dois prova a carga. Qualquer "Plugin not available ... gabarito-mestre" / "dependency-unsatisfied" / "is not installed" sobre o nosso plugin REPROVA
 * (medido na T44: com `--setting-sources project,local` a dependência superpowers ausente DESABILITA o gabarito-mestre — "7 enabled, 2 disabled", sem ele na lista; a célula rodava com o produto ausente). */
export function pluginCarregou(debugLog) {
  const linhas = String(debugLog).split('\n');
  const nosso = /gabarito-mestre(?![\w-])/;
  const indisponivel = linhas.some((l) => nosso.test(l) && /Plugin not available|dependency-unsatisfied|is not installed/.test(l));
  const carregado = linhas.some((l) => /Checking plugin gabarito-mestre:/.test(l));
  return { ok: !indisponivel && carregado, indisponivel, carregado };
}

/** O que o `a1.exp` registrou em exp.log sobre o diálogo de ambiente "Allow external CLAUDE.md file imports?": apareceu e foi recusado (ou não apareceu). */
export function dialogosDoExpLog(expLog) {
  return { importsExternos: /DIALOGO-IMPORTS-EXTERNOS recusado/.test(String(expLog)) ? 'apareceu-e-foi-recusado' : 'nao-apareceu' };
}

/** Versão FIXA do superpowers que a cópia do A1 carrega (T46, emenda 41): a instalada quando a emenda foi aprovada. Nunca "a última do cache". */
export const SUPERPOWERS_VERSAO = '7.0.2';

/** Diretório de configuração da conta que roda (padrão do Claude Code: CLAUDE_CONFIG_DIR, senão ~/.claude). */
export const configDaConta = () => process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');

/** Resolve o superpowers fixo: nome e marketplace vêm da dependência declarada no plugin.json do produto; o caminho, do cache de plugins da conta que roda; a versão é a FIXA.
 * Sem a dependência no plugin.json ⇒ `dependencia_nao_declarada` (nunca um valor fixo no lugar). Versão fixa ausente (sem diretório, sem manifesto ou manifesto de outra versão) ⇒ `{ ok: false, causa: 'dependencia_ausente: <nome>@<versão>' }`: nunca cai para outra versão. */
export function resolverSuperpowers({ config = configDaConta(), pluginJson = join(PLUGIN, '.claude-plugin', 'plugin.json'), versao = SUPERPOWERS_VERSAO } = {}) {
  const dep = (JSON.parse(readFileSync(pluginJson, 'utf8')).dependencies ?? []).find((d) => d?.name === 'superpowers');
  if (dep === undefined) return { ok: false, causa: 'dependencia_nao_declarada: superpowers no plugin.json do produto' };
  const caminho = join(config, 'plugins', 'cache', dep.marketplace, dep.name, versao);
  let manifesto = null;
  try { manifesto = JSON.parse(readFileSync(join(caminho, '.claude-plugin', 'plugin.json'), 'utf8')); } catch { manifesto = null; }
  if (manifesto?.name !== dep.name || manifesto?.version !== versao) return { ok: false, causa: `dependencia_ausente: ${dep.name}@${versao}` };
  return { ok: true, nome: manifesto.name, versao: manifesto.version, caminho };
}

/** `ambiente` do resultado.json: o diálogo de imports (exp.log) mais o superpowers carregado (nome, versão, caminho) ou a causa da ausência. */
export const superpowersNoAmbiente = (sp) => {
  if (sp.ok) return { nome: sp.nome, versao: sp.versao, caminho: sp.caminho };
  const [chave, ...resto] = sp.causa.split(': ');
  return { [chave]: resto.join(': ') };
};
export const ambienteDaExecucao = (expLog, sp) => ({ ...dialogosDoExpLog(expLog), superpowers: superpowersNoAmbiente(sp) });

// ─── CLI ───

function flag(argv, nome) { const i = argv.indexOf(nome); return i >= 0 ? argv[i + 1] : undefined; }

export async function main(argv) {
  // `plugin <debug.log>` (chamado pelo `a1.exp`): rc 0 = gabarito-mestre ativo; rc 1 = não carregou
  if (argv[0] === 'plugin') {
    const r = pluginCarregou(existsSync(argv[1]) ? readFileSync(argv[1], 'utf8') : '');
    process.stdout.write(`${JSON.stringify(r)}\n`);
    return r.ok ? 0 : 1;
  }
  // `superpowers` (diagnóstico): rc 0 = versão fixa presente (imprime nome/versão/caminho); rc 1 = ausente (imprime a causa)
  if (argv[0] === 'superpowers') { const r = resolverSuperpowers(); process.stdout.write(`${JSON.stringify(r)}\n`); return r.ok ? 0 : 1; }
  // `superficie <rundir>` (chamado pelo `a1.exp` antes da 1ª fala): a superfície da célula já foi observada? senão grava abortar.txt e rc 1
  if (argv[0] === 'superficie') {
    const rundir = resolve(argv[1] ?? ''); const celula = celulaDoRundir(rundir);
    const causa = celula === null ? 'célula desconhecida' : invariantePrimeiroSnapshot(jsonl(join(rundir, 'obs', 'a1.jsonl')), celula);
    if (causa === null) return 0;
    writeFileSync(join(rundir, 'abortar.txt'), `${causa}\n`, { flag: 'a' });
    process.stdout.write(`${causa}\n`);
    return 1;
  }
  if (argv[0] === 'snapshot') { await snapshot(argv[1], argv[2], Number(argv[3])); return 0; }
  // `avaliar <rundir> [--roteiro <arq>]`: a avaliação da matriz sobre uma execução JÁ GRAVADA (offline; não abre claude)
  if (argv[0] === 'avaliar') {
    const rundir = resolve(argv[1] ?? '');
    const arqRot = flag(argv, '--roteiro') ?? join(raizPrincipal(AQUI), ROTEIRO_REL);
    let ptsA; try { ptsA = JSON.parse(readFileSync(flag(argv, '--pontos') ?? PONTOS_ARQ, 'utf8')); } catch (e) { process.stderr.write(`pontos.json ilegível: ${e.message}\n`); return 1; }
    const rot = verificarRoteiro(arqRot, ptsA.roteiroSha256);
    if (!rot.ok) { process.stderr.write(`A1 não avalia: ${rot.motivo}\n`); return 1; }
    const exec = await avaliarRundir(rundir, { roteiro: rot, pasta: flag(argv, '--transcripts') ?? null });
    process.stdout.write(`${JSON.stringify(exec, null, 2)}\n`);
    return exec.passa ? 0 : 1;
  }
  // `topo` = a árvore que será commitada (a guarda lê o `git ls-files` dela e a cópia do A1 sai dela); `principal` = onde vivem o roteiro e o `.claude-tmp/`
  const topo = flag(argv, '--raiz') ?? git(AQUI, 'rev-parse', '--show-toplevel').trim();
  const principal = flag(argv, '--raiz') ?? raizPrincipal(AQUI);
  const arqPontos = flag(argv, '--pontos') ?? PONTOS_ARQ;
  const arqRoteiro = flag(argv, '--roteiro') ?? join(principal, ROTEIRO_REL);
  const modo = argv.find((a) => ['--guarda', '--gerar', '--matriz'].includes(a));
  if (modo === undefined) { process.stderr.write('uso: rodar-a1.mjs --guarda | --gerar | --matriz [--so <celula>] [--paralelo <n>] [--roteiro <arq>] | avaliar <rundir>\n'); return 2; }
  let pontos = null;
  if (modo !== '--gerar') {
    try { pontos = JSON.parse(readFileSync(arqPontos, 'utf8')); } catch (e) { process.stderr.write(`pontos.json ilegível: ${e.message}\n`); return 1; }
    const erros = validarPontos(pontos);
    if (erros.length > 0) { process.stderr.write(`pontos.json inválido: ${erros.join('; ')}\n`); return 1; }
  }
  const roteiro = verificarRoteiro(arqRoteiro, pontos?.roteiroSha256 ?? (existsSync(arqRoteiro) ? sha256(readFileSync(arqRoteiro, 'utf8')) : ''));
  if (!roteiro.ok) { process.stderr.write(`A1 não roda: ${roteiro.motivo}\n`); return 1; }
  // a guarda vem ANTES de qualquer execução (e do --gerar): nenhuma fala do roteiro em arquivo versionado
  const g = guardaFalas(topo, roteiro.falas);
  if (!g.ok) { process.stderr.write(`A1 não roda: ${g.achados.length} falas do roteiro em arquivos versionados: ${g.achados.slice(0, 5).map((a) => `${a.arquivo}#${a.n}`).join(', ')}\n`); return 1; }
  process.stdout.write(`guarda das falas: 0 achados (${g.conferidas} falas ≥ ${MIN_FALA} caracteres em ${g.arquivos} arquivos versionados; ${g.ignorados} ignorados por binário ou > 4 MB, não conferidos)\n`);
  if (modo === '--guarda') return 0;
  if (modo === '--gerar') { const r = gerar(topo, principal, roteiro); process.stdout.write(`pontos.json: ${r.pontos} pontos gerados pelo produto\n`); return 0; }
  const m = await matriz(topo, principal, roteiro, flag(argv, '--so') ?? null, { paralelo: Number(flag(argv, '--paralelo') ?? 1), ignorarRefs: [...IGNORAR_REFS_PADRAO, ...argv.flatMap((a, i) => (argv[i - 1] === '--ignorar-ref' ? [new RegExp(a)] : []))] });
  for (const l of m.rel.linhas) process.stdout.write(`${l.passa ? 'PASSA' : 'FALHA'} ${l.celula} ${l.motivo}\n`);
  if (m.abortada !== null) process.stdout.write(`MATRIZ PARADA: ${m.abortada}\n`);
  process.stdout.write(`A1: ${m.rel.passou}/${m.rel.total} (passa = 8/8)\nevidência em ${m.base}\n`);
  return m.rel.ok ? 0 : 1;
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { process.stderr.write(`${e.stack ?? e}\n`); process.exit(1); });
}

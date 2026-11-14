#!/usr/bin/env node
/**
 * Runner do aceite A1 da GM-14 (T24): a conversa real de 2026-11-11, refeita. FORA de `npm test` (abre TUI real do Claude Code e gasta tokens);
 * só as partes puras (forma do `pontos.json`, guarda das falas, asserções sobre a evidência) são importadas por `test/conversa-pontos.test.mjs`.
 *
 *   rodar-a1.mjs --guarda  [--roteiro <arq>]         confere o roteiro (ausente ou sha diferente ⇒ não roda e diz por quê) e que nenhuma fala (≥ 20 caracteres) está em `git ls-files`
 *   rodar-a1.mjs --gerar   [--roteiro <arq>]         regrava `pontos.json`: {msg, sha256, chars} por ponto e o `esperado` GERADO PELO PRODUTO (nunca copiado do roteiro)
 *   rodar-a1.mjs --matriz  [--so <combinações>] [--sem-conversas] [--paralelo <n>] [--roteiro <arq>]   T52 (emenda 45): 8 sessões curtas (placement, lido da TELA) + 2 conversas reais (uma por local, 180×50 cheia, em paralelo) + replay offline das 8 combinações; passa = 8/8; sessão curta reprovada ⇒ as conversas não rodam; células sob TMPDIR (fora do checkout real); `--paralelo` padrão 2
 *   rodar-a1.mjs avaliar-matriz <base> [--roteiro <arq>]   a matriz GRAVADA em <base> (conversas + curta-<id>) avaliada offline, com replay
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
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
    // T52 (emendas 49 e 50): o placement é lido da TELA da sessão real (tty.raw por emulador VT); o debug.log só confirma placed/unplaced (nunca dock/inline).
    const sc = ev.sessaoCurta;
    if (sc === null || sc === undefined) return res(false, 'sem sessão curta de placement (evidência vazia): não medida');
    if (sc.fonte !== 'tela') return res(false, `placement lido de "${sc.fonte}" e não da tela: recusado (replay e debug.log não medem dock/inline)`);
    if (!(sc.quadros > 0)) return res(false, 'sem quadro legível da tela (evidência vazia): não medida');
    if (placementEsperado(ev.celula) !== null && precisaPedido(ev.celula) && sc.pedidoFeito !== true) return res(false, 'o pedido do dono (/gabarito painel) não consta na sessão curta');
    if (sc.antes == null || sc.depois == null) return res(false, 'sem quadro legível da tela nos estágios da sessão curta (evidência vazia): não medida');
    if (ev.debugLogAtivo !== true) return res(false, 'sem debug.log da plataforma com o gabarito-mestre carregado: não medida');
    const esperado = placementEsperado(ev.celula);
    const dbg = Array.isArray(sc.debug) ? sc.debug : [];
    const placed = dbg.some((d) => d.estado === 'placed'); const unplaced = dbg.filter((d) => d.estado === 'unplaced');
    if (esperado === null) return res(sc.antes.placement === null && sc.depois.placement === null && dbg.length === 0, `acima: Pane na tela antes ${sc.antes.placement} / depois ${sc.depois.placement}; ui.open no debug.log ${dbg.length} (esperado: nenhum)`);
    if (!precisaPedido(ev.celula)) {
      if (sc.depois.placement !== esperado) return res(false, `placement esperado ${esperado}; lido na tela ${sc.depois.placement}`);
      return res(placed && unplaced.length === 0, `placement ${esperado} lido na tela sem pedido; debug.log placed ${placed}, unplaced ${unplaced.length}`);
    }
    // abaixo do limiar: (b) respondida pelo runner, aviso INTEIRO na linha única antes do pedido, pedido do dono, Pane colocada na posição da tabela
    const rb = sc.respostaB;
    if (rb == null || !['respondida', 'nao-abriu'].includes(rb.estado)) return res(false, 'a resposta do runner à pergunta (b) não está gravada na evidência (evidência vazia): não medida');
    if (sc.antes.parou === true) return res(false, 'PAROU aberto que não saiu antes do aviso (evidência vazia): não medida');
    if (sc.antes.perguntaAberta === true) return res(false, 'a pergunta (b) continua aberta na linha única depois da resposta do runner (evidência vazia): não medida');
    if (sc.antes.placement !== null) return res(false, `Pane já colocada antes do pedido (${sc.antes.placement}): a tabela medida diz não colocada abaixo do limiar`);
    if (sc.antes.aviso?.estado === 'cortado') return res(false, 'aviso cortado na linha única depois da (b) respondida: o dono não o lê inteiro');
    if (sc.antes.aviso?.estado !== 'inteiro') return res(false, 'aviso ausente na linha única antes do pedido');
    const un = unplaced.find((d) => d.unasked === true);
    if (un === undefined) return res(false, 'sem "unasked … waits unplaced" no debug.log antes do pedido: não medida');
    if (un.limiar != null && sc.antes.aviso.n !== un.limiar) return res(false, `aviso diz ${sc.antes.aviso.n} colunas mas o reason da plataforma diz ${un.limiar}`);
    if (sc.depois.placement !== esperado) return res(false, `depois do pedido, placement esperado ${esperado}; lido na tela ${sc.depois.placement}`);
    return res(placed, `aviso inteiro antes do pedido (N ${sc.antes.aviso.n}); depois do pedido ${esperado} lido na tela; debug.log placed ${placed}`);
  } },
]);

/**
 * Quais asserções cada fonte mede (emenda 45): `desenho` (1, 2) por replay de cada combinação; `placement` (12) pela sessão curta; `comportamento` (as demais) pela conversa real do local.
 * `todas` = as 17 (o que `avaliar <rundir>` e as execuções antigas fazem).
 */
export const GRUPOS = Object.freeze({
  desenho: ['1-depende-no-topo', '2-blocos-e-corte'],
  placement: ['12-placement-da-pane'],
  comportamento: ASSERCOES.map((a) => a.id).filter((id) => !['1-depende-no-topo', '2-blocos-e-corte', '12-placement-da-pane'].includes(id)),
  todas: ASSERCOES.map((a) => a.id),
});

/** Uma execução passa só com TODAS as asserções do `grupo` (padrão `todas`). Asserção que lança reprova (nunca vira "não se aplica"). */
export function avaliarExecucao(ev, grupo = 'todas') {
  const ids = GRUPOS[grupo];
  if (ids === undefined) throw new Error(`grupo de asserções desconhecido: ${grupo}`);
  const resultados = ASSERCOES.filter((a) => ids.includes(a.id)).map((a) => {
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
export function entradaDoSnapshot(obs, ferr, { sessao = 'S-a1', percent = null } = {}) {
  const ultimo = obs.filter((e) => e.ev === 'estado').at(-1);
  const agentes = (ultimo?.agentes ?? []).map((a) => ({ id: a.id, type: a.type ?? '', description: a.description ?? '', status: a.status ?? '', transcript: null }));
  const ids = new Set(agentes.map((a) => a.id));
  const nomes = {};
  for (const [id, v] of Object.entries(ultimo?.nomes ?? {})) if (ids.has(id) && v !== null && typeof v === 'object') nomes[id] = v;
  const acoes = acoesDe(obs.filter((e) => e.ev === 'tool'), agentes, ferr);
  const encerrados = agentes.filter((a) => TERMINAIS.has(a.status)).map((a) => a.id);
  return { agentes, panes: ultimo?.panes ?? [], entrada: { session_id: sessao, sessao: { percent }, agentes, nomes, acoes, encerrados, segundoPlano: [] } };
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
  const t = Date.now();
  const sessao = sessaoRealDe(repo);
  const { agentes, entrada } = entradaDoSnapshot(obs, ferr, { sessao: sessao ?? 'S-a1' });
  const estado = estadoDoProduto(repo, { entrada: JSON.stringify(entrada), bin: join(repo, '..', 'bin'), ghEstado: join(repo, '..', 'gh.json') });
  mkdirSync(join(rundir, 'estados'), { recursive: true });
  writeFileSync(join(rundir, 'estados', `${String(n).padStart(2, '0')}.json`), `${JSON.stringify({ n, t, sessao, props: propsDe(obs), agentes, estado })}\n`);
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
  // lateral: o observador não vê a Pane de outro plugin; bodyRows/bodyColumns saem da TELA no marco `snap-<n>` que o a1.exp grava (emenda 49 a); sem tela ⇒ sem props ⇒ "não medida"
  const ttyArq = join(rundir, 'tty.raw');
  const tela = celula.local === 'lateral' && snaps.some((x) => x.props?.Pane == null) && existsSync(ttyArq) ? emularTela(readFileSync(ttyArq, 'utf8'), celula.rows, celula.cols) : [];
  const paneDaTela = (n) => {
    const q = tela.filter((x) => x.marco === `snap-${n}`).at(-1);
    if (q === undefined) return undefined;
    const cx = caixaDoPainel(q.linhas, celula.cols);
    return cx.placement === null || cx.bodyRows === null || cx.bodyColumns === null ? undefined : { bodyRows: cx.bodyRows, bodyColumns: cx.bodyColumns };
  };
  for (const s of snaps) {
    const props = s.props?.Pane == null && celula.local === 'lateral' ? { ...s.props, Pane: paneDaTela(s.n) } : s.props;
    const linhas = await renderizar(s.estado, props, celula);
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
    // asserção 12 (T52): a sessão curta (tela + debug.log), `null` numa conversa; o debug.log da execução só confirma
    sessaoCurta: lerSessaoCurta(rundir, celula),
    debugLogAtivo: existsSync(join(rundir, 'debug.log')) && pluginCarregou(readFileSync(join(rundir, 'debug.log'), 'utf8')).ok,
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

/** Refs que OUTROS implementadores movem (worktrees `wt/<PBI>-<n>` do próprio loop): o ref cru não diz quem o moveu; quem moveu é lido da identidade (`marcas`). */
const IGNORAR_REFS = Object.freeze([/^refs\/heads\/wt\//]);
/**
 * Linhas de `git status` que o ORQUESTRADOR vivo grava (e só elas): eventos do diário, consultas da Sombra, o plano, aprendizados, ledgers e as worktrees do loop. NÃO é "o diretório inteiro":
 * qualquer outro arquivo de `.harness/` invalida. LIMITE declarado: o conteúdo destes é varrido pela marca da célula só onde a identidade dela é gravada (eventos `autor`); `plano.json`, `sombra/` e ledgers
 * não carregam marca, então o que a célula escrever neles NÃO é visto. Arquivos ignorados pelo git (`.claude-tmp/`, `.harness/PAUSAR`, `pouso-pendente.json`, `contexto/`) nem aparecem no status: não são vistos.
 */
const IGNORAR_STATUS = Object.freeze([
  /^.. "?\.harness\/entregas\/[^/]+\/(events\.[^/]+\.jsonl|plano\.json|sombra\/.*)"?$/,
  /^.. "?\.harness\/aprendizados\.jsonl"?$/,
  /^.. "?\.harness\/worktrees\//,
  /^.. "?docs\/(aprendizados|ledgers)\//,
]);
const TETO_VARREDURA = 16 * 1024 * 1024;

/** Identidade que só a célula tem: e-mail dela. O git da célula a herda do ambiente, então commits, reflogs e eventos do diário (`autor` = `user.email`) a carregam, não importa o texto do comando. */
export const emailDaCelula = (marca) => `${marca}@a1.invalid`;
export const novaMarca = () => `a1-${randomBytes(5).toString('hex')}`;
/** Variáveis de ambiente que dão ao git da célula (inclusive `git config user.email`) a identidade dela: valem para `node -e`, `sh -c` e qualquer subprocesso. */
export const ambienteGitDaCelula = (marca) => ({
  GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'user.email', GIT_CONFIG_VALUE_0: emailDaCelula(marca), GIT_CONFIG_KEY_1: 'user.name', GIT_CONFIG_VALUE_1: marca,
  GIT_AUTHOR_NAME: marca, GIT_AUTHOR_EMAIL: emailDaCelula(marca), GIT_COMMITTER_NAME: marca, GIT_COMMITTER_EMAIL: emailDaCelula(marca),
});

/**
 * A foto de um repo: `git status --porcelain`, `for-each-ref` (sem os refs de worktrees do loop), `worktree list` (só os caminhos, fora das do loop) e `marcas`: o rastro da identidade da célula (`marca`)
 * em reflogs (`reflog show --all`: branch criado, commit, `worktree add`, mesmo com a worktree removida), commits de qualquer ref e no CONTEÚDO dos arquivos de status que o orquestrador também grava.
 * LIMITES (não é cobertura total): a identidade só vale se o git da célula a herda; quem a sobrescreve de propósito (`-c user.email=`, `GIT_*` próprios) apaga o rastro; e vale o que está declarado em `IGNORAR_STATUS`.
 * Quem não é repo ⇒ lança (a prova nunca passa no escuro).
 */
export function fotoDoRepo(raiz, { marca = null } = {}) {
  const g = (...a) => execFileSync('git', ['-C', raiz, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  const refs = g('for-each-ref', '--format=%(refname) %(objectname)').split('\n').filter((l) => l !== '' && !IGNORAR_REFS.some((re) => re.test(l.split(' ')[0]))).join('\n');
  const todas = g('worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length));
  const worktrees = todas.filter((w) => !/\/\.harness\/worktrees\//.test(`${w}/`)).map((w) => `worktree ${w}`).join('\n');
  const linhas = g('status', '--porcelain', '--untracked-files=all').split('\n').filter((l) => l !== '');
  const status = linhas.filter((l) => !IGNORAR_STATUS.some((re) => re.test(l))).join('\n');
  const marcas = [];
  if (marca !== null) {
    for (const l of linhas.filter((x) => IGNORAR_STATUS.some((re) => re.test(x)))) {
      const caminho = l.slice(3).replace(/^"|"$/g, '');
      if (/\/$/.test(caminho) || /\.harness\/worktrees\//.test(caminho)) continue;
      try {
        const st = statSync(join(raiz, caminho));
        if (!st.isFile()) continue;
        if (st.size > TETO_VARREDURA) { marcas.push(`arquivo grande demais para varrer: ${caminho}`); continue; }
        if (readFileSync(join(raiz, caminho), 'utf8').includes(marca)) marcas.push(`arquivo: ${caminho}`);
      } catch { /* sumiu entre o status e a leitura */ }
    }
    for (const l of g('reflog', 'show', '--all', '--format=%gd|%ge|%gn').split('\n')) if (l.includes(marca)) marcas.push(`reflog: ${l.split('|')[0]}`);
    for (const w of todas) {
      try { if (execFileSync('git', ['-C', w, 'reflog', 'show', 'HEAD', '--format=%ge|%gn'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).includes(marca)) marcas.push(`reflog do HEAD: ${w}`); } catch { /* worktree sem reflog */ }
    }
    for (const campo of ['--author', '--committer']) {
      for (const sha of g('log', '--all', '-n', '5', '--format=%H', `${campo}=${marca}`).split('\n').filter(Boolean)) marcas.push(`commit ${campo.slice(2)}: ${sha.slice(0, 10)}`);
    }
  }
  return { status, refs, worktrees, marcas: [...new Set(marcas)].sort().join('\n') };
}
/** Diferenças entre duas fotos (lista vazia = intocado), uma por parte que mudou, com o que mudou (`marcas` = rastro da identidade da célula no repo real). */
export function diferencasDeFotos(antes, depois) {
  const linhas = (t) => new Set(String(t).split('\n').filter(Boolean));
  return ['status', 'refs', 'worktrees', 'marcas'].flatMap((k) => {
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
export function regrasDeNegacao(raizes, home = homedir(), protegidos = []) {
  const alvos = raizes.flatMap((r) => (dentroDe(home, r) && r !== resolve(home) ? [r, r.slice(resolve(home).length + 1)] : [r]));
  // só as famílias que a plataforma casa por caminho: `Read` (leitura) e `Edit` (qualquer escrita); `Write(`/`Glob(`/`Grep(` não são casadas ("only Edit/Read rules are", medido). `protegidos` só perdem a escrita (ex.: o cache do superpowers).
  return [...new Set([...alvos.map((a) => `Bash(*${a}*)`), ...raizes.flatMap((r) => ['Read', 'Edit'].map((f) => `${f}(/${r}/**)`)), ...protegidos.map((r) => `Edit(/${r}/**)`)])];
}

/** Argumentos do `claude` da célula (o `a1.exp` os lê de `<rundir>/claude.args`, um por linha): só caminhos da cópia, modelo Sonnet. */
export function argvDoClaude({ observador, plugin, superpowers, debugLog, settings }) {
  return ['--plugin-dir', observador, '--plugin-dir', plugin, '--plugin-dir', superpowers, '--settings', settings, '--setting-sources', 'project,local', '--strict-mcp-config',
    '--model', MODELO_CONDUTOR, '--permission-mode', 'auto', '--allowedTools', 'Bash(node *)', 'Read', 'ScheduleWakeup', '--debug-file', debugLog];
}

/**
 * O que a plataforma diz do `ui.open` do painel no debug.log: `{colunas, estado: 'placed'|'unplaced'}` por abertura; `unasked: true` quando foi a abertura do mod (sem pedido do dono) e
 * `limiar` (N) quando o `reason` informa "below <N> columns". Confirma a tela, nunca a substitui (o debug.log só diz placed/unplaced, não dock/inline).
 */
export function placementsDoDebugLog(log) {
  const achados = [];
  for (const l of String(log).split('\n')) {
    const m = /ui\.open \S+ gabarito-painel \(([^,)]*), (\d+) columns\): (placed|waits unplaced)(.*)$/.exec(l);
    if (m === null) continue;
    const a = { colunas: Number(m[2]), estado: m[3] === 'placed' ? 'placed' : 'unplaced' };
    if (/^unasked/.test(m[1])) a.unasked = true;
    const n = /below (\d+) columns/.exec(m[4]);
    if (n !== null) a.limiar = Number(n[1]);
    achados.push(a);
  }
  return achados;
}

/**
 * Invariante do 1º snapshot: a superfície da célula já tem render observado; senão a célula nada mede. Devolve a causa ou `null`.
 * `acima` ⇒ o `AbovePrompt` do produto. `lateral` ⇒ qualquer render (o `AbovePrompt` da plataforma): o observador NÃO vê render nem props da Pane de OUTRO plugin
 * (`$.ui.panes` só lista as próprias, emenda 49 fato 1); a Pane lateral é lida da TELA (`lerTela`), não do observador.
 */
export function invariantePrimeiroSnapshot(obs, celula) {
  const rs = obs.filter((e) => e.ev === 'render');
  if (rs.length === 0) return '0 render observado no 1º snapshot (observador sem nenhum render)';
  if (celula.local !== 'acima') return null;
  return rs.some((e) => e.comp === 'AbovePrompt') ? null : '0 render de AbovePrompt no 1º snapshot (a superfície da célula acima não foi observada)';
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
export function executarExpect({ rundir, args, reais, expect = 'expect', intervalo = 10_000, timeoutMs = 4 * 60 * 60 * 1000, fotoOpc = {}, marca = null }) {
  return new Promise((ok) => {
    const antes = reais.map((r) => fotoDoRepo(r, fotoOpc));
    const filho = spawn(expect, args, { cwd: rundir, env: ambienteDe({ PWD: rundir, ...(marca === null ? {} : ambienteGitDaCelula(marca)) }), stdio: 'ignore' });
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
export async function avaliarRundir(rundir, { repo = join(rundir, 'repo'), celula = celulaDoRundir(rundir), roteiro, pasta = null, total = TOTAL_PONTOS, grupo = 'todas' } = {}) {
  if (celula === null) throw new Error(`célula desconhecida para ${rundir} (sem celula.json nem nome <local>-<cols>x<rows>-<cheia|normal>)`);
  return avaliarExecucao(await coletar(rundir, repo, celula, roteiro, { pasta, total }), grupo);
}

/** A sessão curta de UMA combinação (emenda 45 item 3): só a asserção 12, lida da tela; devolve também a geometria que o replay da combinação usa. */
export function avaliarCurta(rundir, celula = celulaDoRundir(rundir)) {
  if (celula === null) throw new Error(`célula desconhecida para ${rundir}`);
  const dbg = join(rundir, 'debug.log');
  const sessaoCurta = lerSessaoCurta(rundir, celula);
  const ev = { celula, sessaoCurta, debugLogAtivo: existsSync(dbg) && pluginCarregou(readFileSync(dbg, 'utf8')).ok };
  return { ...avaliarExecucao(ev, 'placement'), geometria: geometriaDaCurta(sessaoCurta, celula) };
}

const DEPS = { preparar: (...a) => prepararCopia(...a), copiarPlugin, executar: executarExpect, avaliar: (rundir, repo, celula, roteiro, grupo = 'todas') => avaliarRundir(rundir, { repo, celula, roteiro, grupo }), avaliarCurta: (rundir, celula) => avaliarCurta(rundir, celula), superpowers: () => resolverSuperpowers() };

/**
 * A matriz. `base` fica SOB `TMPDIR` (nunca no checkout real); `opc.paralelo` (padrão 1) limita as células simultâneas; cada célula grava o `resultado.json` ao terminar;
 * invariante violada (repo real alterado, plugin não ativo, 0 render no 1º snapshot, célula fora de `TMPDIR`) reprova a célula e PARA a matriz: as demais não rodam e contam como falha.
 */
export async function matriz(fonte, tmpRaiz, roteiro, so, { paralelo = 1, deps = {}, modo = 'conversa', grupo = 'todas', base: baseDada = null } = {}) {
  const d = { ...DEPS, ...deps };
  const celulas = MATRIZ.filter((c) => so === null || so.split(',').includes(idDaCelula(c)));
  const reais = realDe([fonte, tmpRaiz]);
  const curta = modo === 'curta';
  const base = baseDada ?? join(realpathSync(tmpdir()), 'gabarito-a1', String(Date.now()));
  if (reais.some((r) => dentroDe(r, base))) throw new Error(`a célula ficaria dentro do checkout real (${base}): defina TMPDIR fora dele`);
  const ruins = vazamentos(roteiro.falas.map((f) => f.texto), reais);
  if (ruins.length > 0) throw new Error(`${ruins.length} fala(s) do roteiro com caminho do repo real: a célula não pode vê-lo`);
  const execucoes = [];
  let abortada = null;
  const gravar = (id, rundir, exec, ambiente) => writeFileSync(join(rundir, 'resultado.json'), `${JSON.stringify({ ...exec, ambiente }, null, 2)}\n`);
  const executar = async (celula) => {
    const id = idDaCelula(celula);
    const rundir = join(base, `${curta ? 'curta-' : ''}${id}`); const repo = join(rundir, 'repo');
    mkdirSync(join(rundir, 'obs'), { recursive: true });
    const sp = d.superpowers();
    if (!sp.ok) {
      process.stderr.write(`${id}: ${sp.causa}\n`);
      const exec = { celula: id, passa: false, resultados: [{ id: 'dependencia', ok: false, detalhe: sp.causa }] };
      gravar(id, rundir, exec, ambienteDaExecucao('', sp));
      return exec;
    }
    const marca = novaMarca(); const fotoOpc = { marca };
    const antes = reais.map((x) => fotoDoRepo(x, fotoOpc));
    const plugin = join(rundir, 'plugin');
    const { bin } = d.preparar(fonte, repo, celula);
    d.copiarPlugin(plugin);
    escreverObservador(join(rundir, 'observador'));
    writeFileSync(join(rundir, 'celula.json'), `${JSON.stringify(celula)}\n`);
    if (curta) writeFileSync(join(rundir, 'curta.json'), `${JSON.stringify({ pedido: precisaPedido(celula), respostaB: RESPOSTA_B })}\n`);
    writeFileSync(join(rundir, 'inicio.iso'), `${new Date().toISOString()}\n`);
    writeFileSync(join(rundir, 'falas.tsv'), roteiro.falas.map((f) => `${f.n}\t${f.rotulo}\t${sha256(f.texto)}\t${f.texto}`).join('\n'));
    const settings = join(rundir, 'settings.json');
    writeFileSync(settings, `${JSON.stringify({ permissions: { deny: regrasDeNegacao(reais, homedir(), sp.caminho === undefined ? [] : [sp.caminho]) } }, null, 2)}\n`);
    const argv = argvDoClaude({ observador: join(rundir, 'observador'), plugin, superpowers: sp.caminho, debugLog: join(rundir, 'debug.log'), settings });
    writeFileSync(join(rundir, 'claude.args'), `${argv.join('\n')}\n`);
    const vaza = vazamentos([rundir, repo, ...argv], reais);
    if (vaza.length > 0) throw new Error(`argumento da célula com caminho do repo real: ${vaza[0]}`);
    const args = ['-f', join(AQUI, 'a1.exp'), rundir, repo, bin, process.execPath, fileURLToPath(import.meta.url), ...(curta ? ['curta'] : [])];
    const r = await d.executar({ rundir, repo, plugin, argv, celula: id, args, reais, fotoOpc, marca });
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
      try { exec0 = r.status === 0 ? (curta ? await d.avaliarCurta(rundir, celula) : await d.avaliar(rundir, repo, celula, roteiro, grupo)) : null; if (r.status !== 0) nota = `expect rc ${r.status}`; } catch (e) { nota = `coleta falhou: ${e.message}`; process.stderr.write(`${id}: ${nota}\n`); }
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

// ─── a TELA (T52, emendas 49 e 50): emulador VT sobre o tty.raw; placement e aviso lidos do que o dono VÊ ───

/** O observador não vê a Pane de outro plugin (`$.ui.panes` só lista as próprias): render, corte e placement da lateral vêm do `tty.raw` renderizado por um emulador VT. */
const OSC_MARCO = /^1337;gabarito-marco=(.*)$/;

/**
 * Emulador VT mínimo (porte do `emu.mjs` do spike de replay, só node): cursor, apagar, rolagem e a janela síncrona `CSI ?2026 l` (fim de quadro). Devolve `[{linhas, marco}]`: um quadro por
 * fim de janela síncrona, mais um em cada marco e um no fim. O marco é o `OSC 1337;gabarito-marco=<nome> BEL` que o `a1.exp` grava no próprio tty.raw (`send_log`): ancora a tela no estágio da sessão.
 * LIMITE: caractere largo (emoji, CJK) ocupa 1 célula aqui; o mod não desenha emoji (A1 5), então a coluna do separador da dock não se desloca.
 */
export function emularTela(raw, rows, cols) {
  const s = String(raw);
  const nova = () => Array.from({ length: rows }, () => Array(cols).fill(' '));
  let scr = nova(); let r = 0; let c = 0; let top = 0; let bot = rows - 1; let marco = null; let ultima = '';
  const quadros = [];
  const foto = () => {
    const linhas = scr.map((l) => l.join('').replace(/\s+$/, ''));
    const chave = `${marco}\n${linhas.join('\n')}`;
    if (chave === ultima) return;
    ultima = chave;
    quadros.push({ linhas, marco });
  };
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const rola = (n) => { for (let k = 0; k < Math.abs(n); k++) { if (n > 0) { scr.splice(top, 1); scr.splice(bot, 0, Array(cols).fill(' ')); } else { scr.splice(bot, 1); scr.splice(top, 0, Array(cols).fill(' ')); } } };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\x1b') {
      const n = s[i + 1];
      if (n === '[') {
        let j = i + 2;
        while (j < s.length && !/[@-~]/.test(s[j])) j++;
        const f = s[j]; const par = s.slice(i + 2, j);
        const p = par.replace('?', '').split(';').map((x) => (x === '' ? NaN : Number(x)));
        const a = Number.isNaN(p[0]) ? undefined : p[0];
        if (par.startsWith('?')) { if (f === 'l' && par === '?2026') foto(); }
        else {
          switch (f) {
            case 'H': case 'f': r = cl((p[0] || 1) - 1, 0, rows - 1); c = cl((p[1] || 1) - 1, 0, cols - 1); break;
            case 'G': c = cl((a || 1) - 1, 0, cols - 1); break;
            case 'B': r = cl(r + (a || 1), 0, rows - 1); break;
            case 'A': r = cl(r - (a || 1), 0, rows - 1); break;
            case 'C': c = cl(c + (a || 1), 0, cols - 1); break;
            case 'D': c = cl(c - (a || 1), 0, cols - 1); break;
            case 'K': { const m = a || 0; if (m === 0) for (let x = c; x < cols; x++) scr[r][x] = ' '; else if (m === 1) for (let x = 0; x <= c; x++) scr[r][x] = ' '; else scr[r] = Array(cols).fill(' '); break; }
            case 'J': { const m = a || 0; if (m === 2 || m === 3) scr = nova(); else if (m === 0) { for (let x = c; x < cols; x++) scr[r][x] = ' '; for (let y = r + 1; y < rows; y++) scr[y] = Array(cols).fill(' '); } break; }
            case 'r': if (par === '') { top = 0; bot = rows - 1; } else { top = (p[0] || 1) - 1; bot = (p[1] || rows) - 1; } r = 0; c = 0; break;
            case 'S': rola(a || 1); break;
            case 'T': rola(-(a || 1)); break;
            default: break;
          }
        }
        i = j + 1; continue;
      }
      if (n === ']') {
        let j = i + 2;
        while (j < s.length && s[j] !== '\x07' && !(s[j] === '\x1b' && s[j + 1] === '\\')) j++;
        const m = OSC_MARCO.exec(s.slice(i + 2, j));
        if (m !== null) { foto(); marco = m[1]; foto(); }
        i = j + (s[j] === '\x07' ? 1 : 2); continue;
      }
      i += 2; continue;
    }
    if (ch === '\r') { c = 0; i++; continue; }
    if (ch === '\n') { r = cl(r + 1, 0, rows - 1); i++; continue; }
    const cp = s.codePointAt(i); const w = cp > 0xffff ? 2 : 1;
    if (cp >= 32) { if (c >= cols) { c = 0; r = cl(r + 1, 0, rows - 1); } scr[r][c] = String.fromCodePoint(cp); c++; }
    i += w;
  }
  foto();
  return quadros;
}

const celulasDe = (l) => Array.from(l);
const ehBorda = (l, col) => celulasDe(l)[col] === '│';

/**
 * A caixa da Pane do painel numa tela (emenda 49 a): `inline` = caixa de cantos `╭╮╰╯` com o "GABARITO ·" dentro (acima da linha de digitar); `dock` = a Pane ao lado da conversa:
 * uma coluna de `│` contínua com o "GABARITO ·" colado nela. Sem caixa ⇒ `placement: null`. `bodyRows` = linhas internas lidas na tela; `bodyColumns` = largura interna (inline: a caixa
 * menos a borda e 1 de respiro de cada lado; dock: do separador ao fim, precisa de `colunas`). `interior` = o texto das linhas internas.
 */
export function caixaDoPainel(linhas, colunas = null) {
  for (let i = 0; i < linhas.length; i++) {
    const t = linhas[i].trim();
    if (!(t.startsWith('╭') && t.endsWith('╮'))) continue;
    let f = -1;
    for (let k = i + 1; k < linhas.length; k++) {
      const u = linhas[k].trim();
      if (u.startsWith('╰') && u.endsWith('╯')) { f = k; break; }
      if (!(u.startsWith('│') && u.endsWith('│'))) break;
    }
    if (f < 0) continue;
    const interior = linhas.slice(i + 1, f).map((l) => l.trim().replace(/^│ ?/, '').replace(/ ?│$/, '').replace(/\s+$/, ''));
    if (!interior.some((l) => /^GABARITO ·/.test(l))) continue;
    return { placement: 'inline', interior, bodyRows: interior.length, bodyColumns: Math.max(0, celulasDe(t).length - 4) };
  }
  for (let i = 0; i < linhas.length; i++) {
    const at = linhas[i].indexOf('│GABARITO ·');
    if (at < 0) continue;
    const col = celulasDe(linhas[i].slice(0, at)).length;
    let a = i; let b = i;
    while (a > 0 && ehBorda(linhas[a - 1], col)) a--;
    while (b + 1 < linhas.length && ehBorda(linhas[b + 1], col)) b++;
    if (b - a + 1 < 3) continue;
    const interior = linhas.slice(i, b + 1).map((l) => celulasDe(l).slice(col + 1).join('').replace(/\s+$/, ''));
    return { placement: 'dock', interior, bodyRows: b - i + 1, bodyColumns: colunas === null ? null : Math.max(0, colunas - col - 1) };
  }
  return { placement: null, interior: [], bodyRows: null, bodyColumns: null };
}

/** O aviso da Pane não colocada (REQ-GLB-1, emenda 44) INTEIRO numa linha da tela; `cortado` = o prefixo aparece mas a frase não fecha (ex.: "painel …"). */
export const AVISO_RE = /painel lateral precisa de (\d+|mais) colunas: \/gabarito painel para abrir/;
export function avisoNaTela(linhas) {
  for (const l of linhas) {
    const m = AVISO_RE.exec(l);
    if (m !== null) return { estado: 'inteiro', n: m[1] === 'mais' ? null : Number(m[1]) };
  }
  if (linhas.some((l) => /painel( lateral precisa[^…]*)? …/.test(l) || /painel lateral precisa/.test(l))) return { estado: 'cortado', n: null };
  return { estado: null, n: null };
}

/** Tabela da plataforma (T50, spec:47): a partir daqui a Pane lateral nasce sozinha; abaixo, só depois de `/gabarito painel`. O número do AVISO nunca vem daqui: vem do `reason` do debug.log. */
export const LIMIAR_SEM_PEDIDO = 144;
export const precisaPedido = (c) => c.local === 'lateral' && c.cols < LIMIAR_SEM_PEDIDO;
/** Resposta fixa do runner à pergunta (b) (opção 3 da lista, "conversa avulsa"); fica gravada em `resposta-b.json`. */
export const RESPOSTA_B = 3;

/** O comando que o dono digitaria para responder a pergunta aberta (`/gabarito-mestre:responder <id> <n>`), ou `null` se não há pergunta (a (b) não abriu). */
export function comandoDeResposta(pergunta, n = RESPOSTA_B) {
  if (pergunta === null || typeof pergunta !== 'object' || typeof pergunta.id !== 'string' || pergunta.id === '') return null;
  if (!Array.isArray(pergunta.opcoes) || n < 1 || n > pergunta.opcoes.length) return null;
  return `/gabarito-mestre:responder ${pergunta.id} ${n}`;
}

const resumoDoQuadro = (q, cols) => {
  const cx = caixaDoPainel(q.linhas, cols);
  const fora = q.linhas; // PAROU, pergunta e aviso são lidos por início de linha: as linhas da caixa começam em `│` e não casam
  return {
    placement: cx.placement, bodyRows: cx.bodyRows, bodyColumns: cx.bodyColumns, interior: cx.interior,
    aviso: avisoNaTela(fora), parou: fora.some((l) => /^\s*PAROU /.test(l)), perguntaAberta: fora.some((l) => /^\s*depende de você:/.test(l)),
  };
};

/** Props do `AbovePrompt` que o observador leu por último (acima: a geometria vem daqui). */
const abovePromptDe = (obs) => { const e = obs.filter((x) => x.ev === 'render' && x.comp === 'AbovePrompt').at(-1); return e === undefined ? null : { maxRows: e.maxRows ?? null, rows: e.rows ?? null, bodyColumns: e.bodyColumns ?? null }; };

/**
 * A evidência de UMA sessão curta de placement (emenda 45 item 3): a tela do `tty.raw` nos estágios que o `a1.exp` marca (`b-respondida` = pergunta (b) respondida e antes do pedido;
 * `pedido`; `depois-do-pedido`), o `debug.log` (confirma placed/unplaced) e a geometria lida (lateral: caixa na tela; acima: props do AbovePrompt). Sem `curta.json` ⇒ `null`.
 */
export function lerSessaoCurta(rundir, celula) {
  const arq = join(rundir, 'curta.json');
  if (!existsSync(arq)) return null;
  const meta = JSON.parse(readFileSync(arq, 'utf8'));
  const rb = existsSync(join(rundir, 'resposta-b.json')) ? JSON.parse(readFileSync(join(rundir, 'resposta-b.json'), 'utf8')) : null;
  const tty = join(rundir, 'tty.raw');
  const quadros = existsSync(tty) ? emularTela(readFileSync(tty, 'utf8'), celula.rows, celula.cols) : [];
  const marcos = [...new Set(quadros.map((q) => q.marco).filter((m) => m !== null))];
  const ultimoDe = (m) => quadros.filter((q) => q.marco === m).at(-1);
  const a = ultimoDe('b-respondida');
  const antes = a === undefined ? null : resumoDoQuadro(a, celula.cols);
  const d = meta.pedido === true ? ultimoDe('depois-do-pedido') : a;
  const depois = d === undefined ? null : resumoDoQuadro(d, celula.cols);
  const dbgArq = join(rundir, 'debug.log');
  return {
    fonte: 'tela', quadros: quadros.length, marcos, respostaB: rb, pedido: meta.pedido === true, pedidoFeito: marcos.includes('pedido'),
    antes, depois, debug: placementsDoDebugLog(existsSync(dbgArq) ? readFileSync(dbgArq, 'utf8') : ''), abovePrompt: abovePromptDe(jsonl(join(rundir, 'obs', 'a1.jsonl'))),
  };
}

/** A geometria que o replay usa para a combinação: lateral ⇒ a caixa lida na tela depois do pedido; acima ⇒ as props do AbovePrompt. `null` se a sessão curta não a mediu. */
export function geometriaDaCurta(sc, celula) {
  if (sc === null || sc === undefined) return null;
  if (celula.local === 'acima') return sc.abovePrompt != null && sc.abovePrompt.bodyColumns != null ? { AbovePrompt: sc.abovePrompt } : null;
  const d = sc.depois;
  return d != null && d.placement !== null && d.bodyRows !== null && d.bodyColumns !== null ? { Pane: { bodyRows: d.bodyRows, bodyColumns: d.bodyColumns } } : null;
}

// ─── replay offline (T52, emenda 45): o painel redesenhado fora da sessão, a partir do estado gravado, com os 4 controles medidos ───

/** O que só existe ao vivo e o replay NÃO mede (declarado, emenda 45): contexto %, durações e segundo plano. Máscara aplicada a replay e a tela real antes de comparar. */
export const mascararAoVivo = (l) => String(l).replace(/\s+\[[-+]\]$/, '').replace(/contexto (\d+ %|\?)/g, 'contexto N %').replace(/ · \d+[smh]( \d+[smh])?$/, ' · D').replace(/ · hora de pousar/, '').replace(/\s+$/, '');
/** Campo ao vivo AINDA com valor num quadro de replay (a máscara não foi aplicada ou o replay mediu o que não pode): `contexto 12 %`. */
export const camposAoVivoNoQuadro = (linhas) => linhas.filter((l) => /contexto \d+ %/.test(l));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/**
 * O pacote de nomes FIXO da conversa (emenda 45, controle 2): o mod o sorteia da sessão (`sortearPacote(session_id, PACOTES_FABRICA, anterior)`, determinístico) e o guarda; numa conversa com
 * `/clear` o `anterior` é o pacote da sessão que acabou. Sem sessão real não há pacote (`null`: o replay recusa; nunca "terra-media" por omissão).
 */
export async function pacoteDaConversa(repo, sessionId) {
  const sessoes = sessoesDoRepo(repo).map((x) => x.id);
  const i = sessoes.indexOf(sessionId);
  if (i < 0) return null;
  const { sortearPacote } = await import(pathToFileURL(join(GATES, 'dist', 'painel-equipe.js')).href);
  const { PACOTES_FABRICA } = await carregarMod();
  let pacote = null;
  for (const id of sessoes.slice(0, i + 1)) pacote = sortearPacote(id, [...PACOTES_FABRICA], pacote);
  return pacote;
}

/** Sessões reais do repo da conversa: `events.<uuid>.jsonl` de qualquer entrega, com o instante do 1º evento. */
export function sessoesDoRepo(repo) {
  const dirs = join(repo, '.harness', 'entregas');
  const achadas = new Map();
  if (!existsSync(dirs)) return [];
  for (const d of readdirSync(dirs)) {
    for (const a of readdirSync(join(dirs, d))) {
      const m = /^events\.([0-9a-f-]{36})\.jsonl$/.exec(a);
      if (m === null || !UUID.test(m[1])) continue;
      const primeira = readFileSync(join(dirs, d, a), 'utf8').split('\n').find(Boolean);
      let ts = Number.POSITIVE_INFINITY;
      try { ts = Date.parse(JSON.parse(primeira).ts); } catch { /* arquivo sem 1ª linha legível: nunca é "a sessão" de ninguém */ }
      achadas.set(m[1], Math.min(achadas.get(m[1]) ?? Number.POSITIVE_INFINITY, ts));
    }
  }
  return [...achadas].map(([id, inicio]) => ({ id, inicio })).filter((x) => Number.isFinite(x.inicio)).sort((x, y) => x.inicio - y.inicio);
}
/** O `session_id` real da conversa no instante `ate` (ms): a última sessão que já tinha começado. Nenhuma ⇒ `null` (nunca inventa "S-a1"). */
export const sessaoRealDe = (repo, ate = Number.POSITIVE_INFINITY) => sessoesDoRepo(repo).filter((s) => s.inicio <= ate).at(-1)?.id ?? null;

/**
 * A entrada do replay só vale com os controles medidos (emenda 45): `session_id` REAL (uuid de sessão do diário, nunca o "S-a1" do replay ingênuo, que dá 0/52) e `pacote` fixo.
 * Devolve a lista de erros (vazia = válida).
 */
export function validarEntradaDoReplay(entrada, { sessoes = null, pacote = null } = {}) {
  const erros = [];
  if (entrada === null || typeof entrada !== 'object') return ['entrada do replay não é objeto'];
  if (typeof entrada.session_id !== 'string' || !UUID.test(entrada.session_id)) erros.push(`session_id ${JSON.stringify(entrada.session_id)} não é de sessão real (replay ingênuo)`);
  else if (sessoes !== null && !sessoes.includes(entrada.session_id)) erros.push(`session_id ${entrada.session_id} sem diário no repo da conversa`);
  if (typeof pacote !== 'string' || !/^[a-z0-9-]{1,32}$/.test(pacote)) erros.push(`pacote ${JSON.stringify(pacote)} fora do slug (o replay usa o pacote fixo da conversa)`);
  return erros;
}

/** Esqueleto do repo no instante `t` (ms): tudo é symlink para o repo da conversa, menos os diários `.jsonl` de cada entrega, cortados nos eventos com `ts` ≤ `t` (o diário "no instante"). */
export function reconstruirRepo(repo, destino, t) {
  const h = join(destino, '.harness');
  mkdirSync(join(h, 'entregas'), { recursive: true });
  const liga = (de, para) => { try { symlinkSync(de, para); } catch (e) { if (e.code !== 'EEXIST') throw e; } };
  for (const x of readdirSync(repo)) if (x !== '.harness') liga(join(repo, x), join(destino, x));
  for (const x of readdirSync(join(repo, '.harness'))) if (x !== 'entregas') liga(join(repo, '.harness', x), join(h, x));
  for (const e of readdirSync(join(repo, '.harness', 'entregas'))) {
    const dst = join(h, 'entregas', e);
    mkdirSync(dst, { recursive: true });
    for (const a of readdirSync(join(repo, '.harness', 'entregas', e))) {
      const src = join(repo, '.harness', 'entregas', e, a);
      if (!a.endsWith('.jsonl')) { liga(src, join(dst, a)); continue; }
      const linhas = readFileSync(src, 'utf8').split('\n').filter(Boolean).filter((l) => { try { return Date.parse(JSON.parse(l).ts) <= t; } catch { return true; } });
      writeFileSync(join(dst, a), linhas.length > 0 ? `${linhas.join('\n')}\n` : '');
    }
  }
  return destino;
}

let paineisCache = null;
/**
 * `painel.mjs estado --agentes --pacote <slug>` EM PROCESSO, com o relógio injetável (`agoraMs`: o instante do snapshot, nunca o de agora: durações e "há N min" saem do que foi gravado).
 * O ambiente (PATH com o `gh` de fixture, GH_FIXTURE, HOME vazio) é trocado só durante a chamada síncrona e restaurado.
 */
export async function estadoEmProcesso({ repo, entrada, pacote, agoraMs, bin, gh, home }) {
  paineisCache ??= await import(pathToFileURL(join(GATES, 'scripts', 'painel.mjs')).href);
  const antes = { PATH: process.env.PATH, GH_FIXTURE: process.env.GH_FIXTURE, HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
  process.env.PATH = `${bin}:${antes.PATH}`; process.env.GH_FIXTURE = gh; process.env.HOME = home; process.env.CLAUDE_CONFIG_DIR = home;
  let saida = '';
  try {
    const rc = paineisCache.main(['estado', '--agentes', '--pacote', pacote], repo, { saida: (t) => { saida += t; }, aviso: () => {}, stdin: () => JSON.stringify(entrada), agoraMs });
    if (rc !== 0) throw new Error(`painel estado (replay) rc ${rc}: ${saida.slice(0, 160)}`);
    return JSON.parse(saida).estado;
  } finally {
    for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

/**
 * O replay de UM ponto: monta o repo no instante do snapshot, a entrada com `session_id` real, pacote fixo da conversa e ações do observador até aquele instante, pede o estado ao produto
 * (relógio = instante gravado) e desenha pelas funções do mod com a geometria da combinação (`geometria`: `{Pane}` ou `{AbovePrompt}`). Devolve `{linhas (já sem o ao vivo), estado, entrada}`.
 * `deps.estado` troca o produto (testes). Entrada inválida (ingênua) ⇒ lança: o replay nunca corre sem os controles.
 */
export async function replayDoPonto({ conversa, snap, geometria, celula, destino, deps = {} }) {
  const estadoDe = deps.estado ?? estadoEmProcesso;
  const t = Number.isFinite(snap.t) ? snap.t : conversa.t0 ?? Date.now();
  const ferr = await import(pathToFileURL(join(GATES, 'dist', 'ferramentas.js')).href);
  const sessao = sessaoRealDe(conversa.repo, t);
  const pacote = sessao === null ? null : await pacoteDaConversa(conversa.repo, sessao);
  const base = entradaDoSnapshot(jsonlAte(conversa.obs, t), ferr, { sessao, percent: conversa.percent ?? null });
  const erros = validarEntradaDoReplay(base.entrada, { sessoes: sessoesDoRepo(conversa.repo).map((x) => x.id), pacote });
  if (erros.length > 0) throw new Error(`replay recusado: ${erros.join('; ')}`);
  const W = reconstruirRepo(conversa.repo, destino, t);
  const estado = await estadoDe({ repo: W, entrada: base.entrada, pacote, agoraMs: t, bin: join(conversa.rundir, 'bin'), gh: join(conversa.rundir, 'gh.json'), home: conversa.home });
  const props = geometria;
  const bruto = await renderizar(estado, props, celula);
  return { linhas: bruto === null ? null : bruto.map(mascararAoVivo).filter((l) => l !== ''), estado, entrada: base.entrada };
}
const jsonlAte = (obs, t) => obs.filter((e) => !(Number.isFinite(e.t) && e.t > t));

/** `{rundir, repo, obs, ...}` de uma conversa gravada. */
export function lerConversa(rundir, { home }) {
  const repo = join(rundir, 'repo');
  const sid = sessaoRealDe(repo);
  let percent = null;
  try { percent = JSON.parse(readFileSync(join(repo, '.harness', 'contexto', `${sid}.json`), 'utf8')).percent ?? null; } catch { percent = null; }
  return { rundir, repo, obs: jsonl(join(rundir, 'obs', 'a1.jsonl')), percent, home };
}

const snapsDe = (rundir) => {
  const d = join(rundir, 'estados');
  if (!existsSync(d)) return [];
  return readdirSync(d).sort().map((f) => { const s = JSON.parse(readFileSync(join(d, f), 'utf8')); return { ...s, t: Number.isFinite(s.t) ? s.t : statSync(join(d, f)).mtimeMs, _arq: f }; });
};

/**
 * O replay da conversa inteira para UMA combinação: cada snapshot redesenhado com a geometria da combinação. Devolve a evidência de DESENHO que as asserções 1 e 2 leem
 * (`quadros`, `quadrosSemProps`, `celula`). Geometria ausente (a sessão curta não a mediu) ⇒ `quadrosSemProps = n`: "não medida", nunca vazio-passa.
 */
export async function replayDaConversa({ conversa, celula, geometria, destino, deps = {} }) {
  const snaps = snapsDe(conversa.rundir);
  const quadros = []; let quadrosSemProps = 0;
  for (const s of snaps) {
    if (geometria === null || geometria === undefined) { quadrosSemProps += 1; continue; }
    const r = await replayDoPonto({ conversa, snap: s, geometria, celula, destino: join(destino, s._arq.replace(/\.json$/, '')), deps });
    if (r.linhas === null) { quadrosSemProps += 1; continue; }
    if (camposAoVivoNoQuadro(r.linhas).length > 0) throw new Error('replay com campo ao vivo (contexto %) no quadro: a máscara não foi aplicada');
    quadros.push({ linhas: r.linhas, itensDepende: (r.estado.depende ?? []).length + (r.estado.pergunta ? 1 : 0) + (r.estado.parar ? 1 : 0) });
  }
  return { celula, quadros, quadrosSemProps, n: snaps.length };
}

/** Só as asserções de DESENHO (1 e 2) são medidas por replay: o placement (12) e as de comportamento só existem em sessão real. Pedir outra ⇒ lança (recusado). */
export const ASSERCOES_DE_DESENHO = Object.freeze(['1-depende-no-topo', '2-blocos-e-corte']);
export const ASSERCOES_DE_PLACEMENT = Object.freeze(['12-placement-da-pane']);
export function avaliarPorReplay(ev, ids = ASSERCOES_DE_DESENHO) {
  const fora = ids.filter((id) => !ASSERCOES_DE_DESENHO.includes(id));
  if (fora.length > 0) throw new Error(`replay recusado para ${fora.join(', ')}: só o desenho (1, 2) se mede por replay; placement e comportamento são de sessão real (emenda 45)`);
  if (!(ev.n > 0)) return ids.map((id) => ({ id, ref: ASSERCOES.find((a) => a.id === id).ref, ok: false, detalhe: 'replay sem nenhum ponto (evidência vazia): não medida' }));
  return avaliarExecucao(ev, 'desenho').resultados.filter((r) => ids.includes(r.id));
}

/** Os blocos de um quadro da faixa (`acima`) na tela real: do "GABARITO ·" até a 1ª linha vazia/régua. Distintos, na ordem em que apareceram. */
export function blocosDaFaixaNaTela(quadros, rows) {
  const norm = mascararAoVivo;
  const vistos = new Set(); const blocos = [];
  for (const q of quadros) {
    const h = q.linhas.findIndex((l) => l.startsWith('GABARITO ·'));
    if (h < 0) continue;
    const b = [];
    for (let k = h; k < rows && k < h + 16; k++) { const l = q.linhas[k]; if (k > h && (l === '' || l.startsWith('─') || /\/effort/.test(l))) break; b.push(norm(l)); }
    const chave = b.join('\n');
    if (!vistos.has(chave)) { vistos.add(chave); blocos.push(b); }
  }
  return blocos;
}
/**
 * A estrutura de um quadro: a sequência dos blocos (ordem e quais cortes), independente do texto. O ATENÇÃO fica FORA (declarado): na tela real os botões da pergunta, desenhados pela
 * plataforma, quebram a linha e empurram o ATENÇÃO para fora da altura; o replay não desenha botão. Medido no spike de replay (cmp5): 26/26 sem o ATENÇÃO.
 */
export const estruturaDe = (linhas) => linhas.map((l) => /^(GABARITO|PAROU|depende de você|última entrega|FASE|PRONTO|AGORA|RECENTE)/.exec(l)?.[1]).filter(Boolean).join(',');

// ─── a matriz por conversa (T52, emenda 45): 2 conversas reais + 8 sessões curtas + replay offline; passa = 8/8 ───

/** A conversa real de cada local (180×50 tela cheia): dela saem as asserções de comportamento (3–11, 8a–8f) e os snapshots que o replay redesenha. */
export const conversaDoLocal = (local) => idDaCelula({ local, cols: 180, rows: 50, cheia: true });
export const CONVERSAS = Object.freeze(['lateral', 'acima'].map(conversaDoLocal));

const semEvidencia = (id, detalhe) => ({ id, ref: ASSERCOES.find((a) => a.id === id)?.ref ?? id, ok: false, detalhe });

/**
 * A matriz GRAVADA em `base`: `<id>` das 2 conversas e `curta-<id>` das 8 combinações. Cada combinação junta as 3 fontes (emenda 45 item 4): comportamento da conversa do seu local,
 * desenho (1, 2) por replay dos snapshots dessa conversa com a geometria da sua sessão curta, placement (12) pela sessão curta. Fonte que falta ou que lança reprova a combinação
 * (nunca "não se aplica"); combinação não desenhada continua falha. Offline: não abre claude.
 */
export async function avaliarGravada(base, roteiro, { deps = {} } = {}) {
  const d = {
    conversa: (rundir) => avaliarRundir(rundir, { roteiro, grupo: 'comportamento' }),
    curta: (rundir, celula) => avaliarCurta(rundir, celula),
    replay: replayDaConversa,
    ...deps,
  };
  const home = join(base, 'replay-home');
  mkdirSync(home, { recursive: true });
  const comportamento = new Map();
  for (const local of ['lateral', 'acima']) {
    const rundir = join(base, conversaDoLocal(local));
    try {
      if (!existsSync(rundir)) throw new Error('conversa não executada');
      comportamento.set(local, { rundir, resultados: (await d.conversa(rundir)).resultados });
    } catch (e) { comportamento.set(local, { rundir, erro: String(e.message ?? e).slice(0, 160) }); }
  }
  const execucoes = [];
  for (const c of MATRIZ) {
    const id = idDaCelula(c);
    const resultados = [];
    let geometria = null;
    const curtaDir = join(base, `curta-${id}`);
    try {
      if (!existsSync(curtaDir)) throw new Error('sessão curta não executada');
      const cr = await d.curta(curtaDir, c);
      geometria = cr.geometria ?? null;
      resultados.push(...cr.resultados);
    } catch (e) { resultados.push(semEvidencia('12-placement-da-pane', `sessão curta: ${String(e.message ?? e).slice(0, 160)}`)); }
    const conv = comportamento.get(c.local);
    if (conv.erro !== undefined) {
      resultados.push(...GRUPOS.comportamento.map((i) => semEvidencia(i, `conversa ${conversaDoLocal(c.local)}: ${conv.erro}`)));
      resultados.push(...GRUPOS.desenho.map((i) => semEvidencia(i, `sem conversa para o replay: ${conv.erro}`)));
    } else {
      resultados.push(...conv.resultados);
      try {
        const ev = await d.replay({ conversa: lerConversa(conv.rundir, { home }), celula: c, geometria, destino: join(base, 'replay', id) });
        resultados.push(...avaliarPorReplay(ev));
      } catch (e) { resultados.push(...GRUPOS.desenho.map((i) => semEvidencia(i, `replay: ${String(e.message ?? e).slice(0, 160)}`))); }
    }
    execucoes.push({ celula: id, passa: resultados.length === GRUPOS.todas.length && resultados.every((r) => r.ok), resultados });
  }
  return { rel: avaliarMatriz(execucoes), execucoes };
}

/**
 * A matriz inteira, na ordem do mais barato ao mais caro: (1) as 8 sessões curtas (placement e geometria); (2) se TODAS passaram e nenhuma invariante caiu, as 2 conversas reais em paralelo;
 * (3) avaliação offline. Sessão curta reprovada ou invariante violada PARA antes das conversas (parada cedo): quem reprova 1 combinação já reprova o 8/8.
 * `opc.so` restringe as curtas; `opc.semConversas` pula (2) (as combinações ficam "conversa não executada" ⇒ falham: só para iterar o placement barato).
 */
export async function matrizA1(fonte, tmpRaiz, roteiro, { so = null, semConversas = false, paralelo = 2, deps = {} } = {}) {
  const base = join(realpathSync(tmpdir()), 'gabarito-a1', String(Date.now()));
  const mat = deps.matriz ?? matriz;
  const avalia = deps.avaliarGravada ?? avaliarGravada;
  const curtas = await mat(fonte, tmpRaiz, roteiro, so, { paralelo, deps: deps.celula ?? {}, modo: 'curta', base });
  let parouCedo = null;
  if (curtas.abortada !== null) parouCedo = `sessão curta: ${curtas.abortada}`;
  else if (curtas.execucoes.some((x) => x.passa !== true)) parouCedo = `sessão curta reprovada em ${curtas.execucoes.filter((x) => x.passa !== true).map((x) => x.celula).join(', ')}: as conversas não rodam`;
  let conversas = null;
  if (parouCedo === null && !semConversas) {
    conversas = await mat(fonte, tmpRaiz, roteiro, CONVERSAS.join(','), { paralelo, deps: deps.celula ?? {}, grupo: 'comportamento', base });
    if (conversas.abortada !== null) parouCedo = `conversa: ${conversas.abortada}`;
  }
  const { rel } = await avalia(base, roteiro, { deps: deps.gravada ?? {} });
  return { rel, base, abortada: parouCedo, curtas, conversas };
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
  // `resposta-b <repo> <rundir>` (chamado pelo `a1.exp` da sessão curta): imprime o comando com que o dono responderia a pergunta (b) (vazio se ela não abriu) e grava `resposta-b.json` na evidência
  if (argv[0] === 'resposta-b') {
    const repo = resolve(argv[1] ?? ''); const rundir = resolve(argv[2] ?? '');
    const obs = jsonl(join(rundir, 'obs', 'a1.jsonl'));
    const ferr = await import(pathToFileURL(join(GATES, 'dist', 'ferramentas.js')).href);
    const { entrada } = entradaDoSnapshot(obs, ferr, { sessao: sessaoRealDe(repo) ?? 'S-a1' });
    const estado = estadoDoProduto(repo, { entrada: JSON.stringify(entrada), bin: join(rundir, 'bin'), ghEstado: join(rundir, 'gh.json') });
    const cmd = comandoDeResposta(estado.pergunta);
    writeFileSync(join(rundir, 'resposta-b.json'), `${JSON.stringify({ estado: cmd === null ? 'nao-abriu' : 'respondida', pergunta: estado.pergunta?.id ?? null, resposta: cmd === null ? null : RESPOSTA_B })}\n`);
    process.stdout.write(cmd === null ? '' : `${cmd}\n`);
    return 0;
  }
  // `avaliar-matriz <base>`: a matriz GRAVADA (2 conversas + 8 sessões curtas) avaliada offline, com replay
  if (argv[0] === 'avaliar-matriz') {
    const base = resolve(argv[1] ?? '');
    const arqRot = flag(argv, '--roteiro') ?? join(raizPrincipal(AQUI), ROTEIRO_REL);
    let pts; try { pts = JSON.parse(readFileSync(flag(argv, '--pontos') ?? PONTOS_ARQ, 'utf8')); } catch (e) { process.stderr.write(`pontos.json ilegível: ${e.message}\n`); return 1; }
    const rot = verificarRoteiro(arqRot, pts.roteiroSha256);
    if (!rot.ok) { process.stderr.write(`A1 não avalia: ${rot.motivo}\n`); return 1; }
    const g = await avaliarGravada(base, rot);
    for (const l of g.rel.linhas) process.stdout.write(`${l.passa ? 'PASSA' : 'FALHA'} ${l.celula} ${l.motivo}\n`);
    process.stdout.write(`A1: ${g.rel.passou}/${g.rel.total} (passa = 8/8)\n`);
    return g.rel.ok ? 0 : 1;
  }
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
  const m = await matrizA1(topo, principal, roteiro, { so: flag(argv, '--so') ?? null, semConversas: argv.includes('--sem-conversas'), paralelo: Number(flag(argv, '--paralelo') ?? 2) });
  for (const l of m.rel.linhas) process.stdout.write(`${l.passa ? 'PASSA' : 'FALHA'} ${l.celula} ${l.motivo}\n`);
  if (m.abortada !== null) process.stdout.write(`MATRIZ PARADA: ${m.abortada}\n`);
  process.stdout.write(`A1: ${m.rel.passou}/${m.rel.total} (passa = 8/8)\nevidência em ${m.base}\n`);
  return m.rel.ok ? 0 : 1;
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { process.stderr.write(`${e.stack ?? e}\n`); process.exit(1); });
}

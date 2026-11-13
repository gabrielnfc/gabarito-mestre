#!/usr/bin/env node
/**
 * Runner do aceite A1 da GM-14 (T24): a conversa real de 2026-11-11, refeita. FORA de `npm test` (abre TUI real do Claude Code e gasta tokens);
 * só as partes puras (forma do `pontos.json`, guarda das falas, asserções sobre a evidência) são importadas por `test/conversa-pontos.test.mjs`.
 *
 *   rodar-a1.mjs --guarda  [--roteiro <arq>]         confere o roteiro (ausente ou sha diferente ⇒ não roda e diz por quê) e que nenhuma fala (≥ 20 caracteres) está em `git ls-files`
 *   rodar-a1.mjs --gerar   [--roteiro <arq>]         regrava `pontos.json`: {msg, sha256, chars} por ponto e o `esperado` GERADO PELO PRODUTO (nunca copiado do roteiro)
 *   rodar-a1.mjs --matriz  [--so <local-tamanho-cheia>] [--roteiro <arq>]   as 8 execuções (local × tamanho × tela cheia) com `a1.exp`; passa = 8/8
 *   rodar-a1.mjs snapshot <repo> <rundir> <n>        (chamado pelo `a1.exp`) grava o `estado` do produto no ponto n
 *
 * As falas NUNCA vão ao repositório: `pontos.json` guarda só o número da mensagem no roteiro, o sha256 e o tamanho. As falas do roteiro só existem em
 * `.superpowers/` (fora do git) e, durante uma execução, em `<rundir>/falas.tsv` (sob `.claude-tmp/`, ignorado).
 *
 * LIMITE DECLARADO: o A1 completo exige sessões interativas reais do Claude Code (8 × ~62 mensagens). Este runner as dirige por `a1.exp`, mas o ambiente que
 * escreveu o código não as abriu: o que nele toca o TUI (`a1.exp`, o observador de Pane, a leitura do transcript) é presumido até a 1ª execução real (T25).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
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

/** Linhas da tabela do roteiro (`| # | hora | mensagem | ponto? | por quê |`): `{n, texto, rotulo}`. */
export function falasDoRoteiro(conteudo) {
  const falas = [];
  for (const linha of conteudo.split('\n')) {
    const m = /^\| (\d+) \| (\d\d:\d\d:\d\d) \| (.*) \| (—|[A-ZÇÃÕ ]+) \| (.*) \|$/u.exec(linha);
    if (m !== null) falas.push({ n: Number(m[1]), hora: m[2], texto: m[3], rotulo: m[4] });
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

export const ASSERCOES = Object.freeze([
  { id: '1-depende-no-topo', ref: 'A1 (1)', avaliar: (ev) => {
    // o cabeçalho "GABARITO · <entrega>" pode abrir o quadro; o DEPENDE vem antes de qualquer outro bloco e, havendo item, nunca falta (nada cortado do topo)
    const ruins = ev.quadros.filter((q) => {
      const ls = q.linhas.filter((l) => !/^GABARITO ·/.test(l));
      const i = ls.findIndex((l) => BLOCOS[0][1].test(l));
      if (q.itensDepende > 0 && i !== 0) return true;
      return i > 0;
    });
    return res(ev.quadros.length > 0 && ruins.length === 0, `${ev.quadros.length} quadros, ${ruins.length} com o DEPENDE fora do topo ou cortado`);
  } },
  { id: '2-blocos-e-corte', ref: 'A1 (2)', avaliar: (ev) => {
    const { cols, rows } = ev.celula;
    const cheio = ev.quadros.reduce((m, q) => (blocosDe(q.linhas).length > blocosDe(m?.linhas ?? []).length ? q : m), null);
    if (cheio === null) return res(false, 'sem quadro');
    const presentes = blocosDe(cheio.linhas);
    if (cols === 80 && rows === 24) {
      // blocos 1–3 presentes e o RECENTE é o primeiro a sair: o que sobra é prefixo da ordem de corte
      const prefixo = presentes.every((b, i) => b === ORDEM_CORTE[i]);
      const tres = ORDEM_CORTE.slice(0, 3).every((b) => presentes.includes(b));
      return res(tres && prefixo, `blocos ${presentes.join(',')}`);
    }
    const cap = ev.celula.local === 'acima' ? 2 : 5;
    const rec = cheio.linhas.filter((l) => /^(RECENTE ·|  \d\d:\d\d )/.test(l));
    const comOrigem = rec.every((l) => /\([^)]+\)\s*$/.test(l));
    return res(ORDEM_CORTE.every((b) => presentes.includes(b)) && rec.length >= 1 && rec.length <= cap && comOrigem, `blocos ${presentes.join(',')}; RECENTE ${rec.length} (teto ${cap}); com origem ${comOrigem}`);
  } },
  { id: '3-sem-task-integrada', ref: 'A1 (3)', avaliar: (ev) => {
    const linhas = ev.quadros.flatMap((q) => q.linhas).filter((l) => !/^(RECENTE ·|PRONTO |FASE |GABARITO ·)/.test(l) && !/^  \d\d:\d\d /.test(l));
    const ruins = linhas.filter((l) => ev.integradas.some((id) => new RegExp(`(?<![A-Za-z0-9])${id}(?![A-Za-z0-9])`).test(l)));
    return res(ruins.length === 0, `${ruins.length} linhas citam task integrada fora do RECENTE e do PRONTO`);
  } },
  { id: '4-agora-ativos', ref: 'A1 (4)', avaliar: (ev) => {
    const d = ev.vivos.detalhes;
    const nomes = d.map((v) => v.nome);
    const ok = d.every((v) => v.nome && v.task && v.acao) && new Set(nomes).size === nomes.length;
    return res(ok, `${d.length} vivos; nomes únicos ${new Set(nomes).size === nomes.length}`);
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
    const edits = ev.transcript.chamadas.filter((c) => (c.nome === 'Edit' || c.nome === 'Write') && String(c.entrada?.file_path ?? '').includes('/.harness/'));
    const aMao = ev.transcript.textos.filter((t) => /^(GABARITO ·|FASE \d de 7|PRONTO [▰▱])/m.test(t));
    return res(edits.length === 0 && aMao.length === 0, `${edits.length} Edit/Write em .harness/; ${aMao.length} blocos de status à mão`);
  } },
  { id: '8a-dono-mensagem-sem-duplicata', ref: 'A1 (8) Emenda 1', avaliar: (ev) => {
    const por = new Map();
    for (const e of ev.eventos) if (e.tipo === 'dono.mensagem') por.set(e.dados.sha256, (por.get(e.dados.sha256) ?? 0) + 1);
    const digitadas = new Map();
    for (const s of ev.digitadas) digitadas.set(s, (digitadas.get(s) ?? 0) + 1);
    const ruins = [...por].filter(([sha, n]) => n > (digitadas.get(sha) ?? 0));
    return res(ruins.length === 0, `${ruins.length} textos gravados mais vezes do que digitados`);
  } },
  { id: '8b-agent-nao-negado-em-status', ref: 'A1 (8) Emenda 1', avaliar: (ev) => {
    const ruins = ev.transcript.chamadas.filter((c) => c.nome === 'Agent' && c.negada === true && c.turnoDeStatus === true);
    return res(ruins.length === 0, `${ruins.length} Agent negados em turno de pergunta de status`);
  } },
  { id: '8c-nada-em-entrega-publicada', ref: 'A1 (8) Emenda 1', avaliar: (ev) => {
    const ruins = ev.entregasPublicadas.filter((id) => (ev.gravacoes[id]?.depois ?? 0) !== (ev.gravacoes[id]?.antes ?? 0));
    return res(ruins.length === 0, `${ruins.length} entregas publicadas com gravação nova`);
  } },
  { id: '8d-vivo-com-nome-descricao-task', ref: 'A1 (8) Emenda 1', avaliar: (ev) => {
    const ruins = ev.vivos.detalhes.filter((v) => !(v.nome && v.descricao && v.task));
    return res(ruins.length === 0, `${ruins.length} vivos sem nome, descrição ou task`);
  } },
  { id: '8e-vivos-igual-linhas-de-agente', ref: 'A1 (8) Emenda 1', avaliar: (ev) => res(ev.vivos.ativos === ev.vivos.linhasAgente, `${ev.vivos.ativos} ativos, ${ev.vivos.linhasAgente} linhas de agente`) },
  { id: '8f-sombra-decisao-visivel', ref: 'A1 (8) Emenda 1', avaliar: (ev) => {
    const decisoes = ev.eventos.filter((e) => e.tipo === 'decisao.sombra').length;
    const visiveis = ev.quadros.flatMap((q) => q.linhas).filter((l) => /Sombra/.test(l)).length;
    return res(decisoes === 0 || visiveis >= 1, `${decisoes} decisões da Sombra registradas, ${visiveis} linhas que a mostram`);
  } },
  { id: '9-veredito-com-revisor-antes', ref: 'A1 (9)', avaliar: (ev) => {
    const armado = new Set();
    let ruins = 0;
    for (const e of ev.eventos) {
      const task = e.dados?.task;
      if (e.tipo === 'task.iniciada' && e.dados?.papel === 'revisor') armado.add(task);
      if (e.tipo === 'review.veredito') { if (!armado.has(task)) ruins += 1; armado.delete(task); }
    }
    return res(ruins === 0, `${ruins} vereditos sem revisor iniciado antes no ciclo`);
  } },
  { id: '10-despachos-com-aprendizados', ref: 'A1 (10)', avaliar: (ev) => {
    const ruins = ev.despachos.filter((d) => d.aprendizados.some((r) => !d.prompt.includes(r)));
    return res(ev.despachos.length >= 1 && ruins.length === 0, `${ev.despachos.length} despachos, ${ruins.length} sem os aprendizados do item de proxima`);
  } },
  { id: '11-pouso-a-50', ref: 'A1 (11)', avaliar: (ev) => {
    const p = ev.pouso;
    return res(p.percent >= 50 && p.limparNoDepende === true && p.pushes === 1 && p.despachosDepois === 0, `pouso a ${p.percent} %; "limpar a conversa" no DEPENDE ${p.limparNoDepende}; ${p.pushes} push; ${p.despachosDepois} despachos antes do /clear`);
  } },
  { id: '12-placement-da-pane', ref: 'A1 (12)', avaliar: (ev) => {
    const esperado = placementEsperado(ev.celula);
    const vistos = ev.panes.map((p) => p.placement);
    const ok = esperado === null ? vistos.length === 0 : vistos.length === 1 && vistos[0] === esperado;
    return res(ok, `placement esperado ${esperado}; lido ${JSON.stringify(vistos)}`);
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
  return { bin, gh: join(destino, '..', 'gh.json') };
}

/** Mod só de teste: registra a cada 3 s a lista de agentes (com `description`) e as Panes (`placement`) em `$OBS_DIR/a1.jsonl`. Sem texto de prompt. */
export function escreverObservador(destino) {
  mkdirSync(join(destino, '.claude-plugin'), { recursive: true });
  mkdirSync(join(destino, 'hooks'), { recursive: true });
  writeFileSync(join(destino, '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'observador-a1', version: '0.0.1', description: 'Observador do A1 (GM-14 T24): agentes e placement das Panes.' })}\n`);
  writeFileSync(join(destino, 'hooks', 'hooks.json'), `${JSON.stringify({ modules: ['../register.mjs'] })}\n`);
  writeFileSync(join(destino, 'register.mjs'), `let dir = null; const buf = []; let cadeia = Promise.resolve(); let ultimo = '';
const log = ($, o) => { cadeia = cadeia.then(async () => { if (dir === null) return; buf.push(JSON.stringify({ t: await $.clock.now(), ...o })); await $.fs.write(dir + '/a1.jsonl', buf.join('\\n') + '\\n'); }).catch(() => {}); return cadeia; };
export const register = (on) => {
  on('session.start', async ($, e, next) => {
    try { dir = (await $.env.get('OBS_DIR')) ?? null; } catch { dir = null; }
    try {
      $.clock.every(3000, async () => {
        let agentes = []; let panes = [];
        try { agentes = (await $.agent.list()).map((a) => ({ id: String(a.id), type: a.type ?? null, status: a.status ?? null, description: a.description ?? null })); } catch { agentes = null; }
        try { panes = (await $.ui.panes()).map((p) => ({ id: String(p.id ?? ''), placement: p.placement ?? null })); } catch { panes = null; }
        const chave = JSON.stringify([agentes, panes]);
        if (chave !== ultimo) { ultimo = chave; await log($, { ev: 'estado', agentes, panes }); }
      });
    } catch { /* sem relógio */ }
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

/** Subcomando `snapshot` (chamado pelo `a1.exp` depois de cada ponto): guarda o `estado` do produto com os agentes que o observador viu. */
function snapshot(repo, rundir, n) {
  const obs = jsonl(join(rundir, 'obs', 'a1.jsonl')).filter((e) => e.ev === 'estado').at(-1);
  const agentes = (obs?.agentes ?? []).map((a) => ({ id: a.id, type: a.type, description: a.description, status: a.status, transcript: null }));
  const entrada = JSON.stringify({ session_id: 'S-a1', sessao: { percent: null }, agentes });
  const estado = estadoDoProduto(repo, { entrada, bin: join(repo, '..', 'bin'), ghEstado: join(repo, '..', 'gh.json') });
  mkdirSync(join(rundir, 'estados'), { recursive: true });
  writeFileSync(join(rundir, 'estados', `${String(n).padStart(2, '0')}.json`), `${JSON.stringify(estado)}\n`);
}

async function renderizar(estado, celula) {
  const { renderPainel } = await import(pathToFileURL(join(GATES, 'dist', 'painel.js')).href);
  const { paraTexto } = await import(pathToFileURL(join(GATES, 'dist', 'painel-texto.js')).href);
  const { orcamentoDe } = await import(pathToFileURL(join(GATES, 'dist', 'orcamento.js')).href);
  const larg = Math.max(1, celula.cols - 5); // `bodyColumns` = colunas − 5 (spikes-tui S1)
  const maxRows = celula.cheia ? Math.floor(celula.rows / 2) - 5 : celula.rows;
  const orcamento = celula.local === 'acima' ? orcamentoDe(celula.rows, maxRows) : 7;
  const linhas = renderPainel(estado, { preset: 'esquadrao', tema: 'mono', narracao: true, largura: larg, orcamento, altura: orcamento, local: celula.local });
  return paraTexto(linhas, 'mono').split('\n').filter((l) => l !== '');
}

/** Junta a evidência de uma execução (diário, observador, estados, transcripts) no formato que `avaliarExecucao` espera. */
export async function coletar(rundir, repo, celula, roteiro) {
  const dirs = join(repo, '.harness', 'entregas');
  const eventos = [];
  const gravacoes = {};
  const inicio = existsSync(join(rundir, 'inicio.iso')) ? readFileSync(join(rundir, 'inicio.iso'), 'utf8').trim() : '';
  if (existsSync(dirs)) {
    for (const d of readdirSync(dirs)) {
      // linha ilegível reprova a execução (não some)
      for (const a of readdirSync(join(dirs, d)).filter((x) => /^events\..+\.jsonl$/.test(x))) {
        const linhas = readFileSync(join(dirs, d, a), 'utf8').split('\n').filter(Boolean);
        for (const l of linhas) { try { eventos.push({ ...JSON.parse(l), _entrega: d }); } catch { throw new Error(`diário ilegível: ${d}/${a}`); } }
      }
      const dele = eventos.filter((e) => e._entrega === d);
      gravacoes[d] = { antes: dele.filter((e) => e.ts <= inicio).length, depois: dele.length };
    }
  }
  const sends = existsSync(join(rundir, 'sends.log')) ? readFileSync(join(rundir, 'sends.log'), 'utf8').split('\n').filter(Boolean) : [];
  const digitadas = sends.map((l) => /^\d+ digitar ([0-9a-f]{64})$/.exec(l)?.[1]).filter(Boolean);
  const obs = jsonl(join(rundir, 'obs', 'a1.jsonl')).filter((e) => e.ev === 'estado');
  const ultimo = obs.at(-1);
  const estadosDir = join(rundir, 'estados');
  const estados = existsSync(estadosDir) ? readdirSync(estadosDir).sort().map((f) => ({ n: Number(f.slice(0, 2)), estado: JSON.parse(readFileSync(join(estadosDir, f), 'utf8')) })) : [];
  const quadros = [];
  for (const { estado } of estados) quadros.push({ linhas: await renderizar(estado, celula), itensDepende: (estado.depende ?? []).length + (estado.pergunta ? 1 : 0) + (estado.parar ? 1 : 0) });
  const pasta = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects', realpathSync(repo).replace(/[^A-Za-z0-9-]/g, '-'));
  const chamadas = []; const textos = []; const despachos = [];
  if (existsSync(pasta)) {
    for (const f of readdirSync(pasta).filter((x) => x.endsWith('.jsonl'))) {
      const negadas = new Set();
      const linhas = jsonl(join(pasta, f));
      for (const l of linhas) for (const b of Array.isArray(l.message?.content) ? l.message.content : []) if (b.type === 'tool_result' && b.is_error === true) negadas.add(b.tool_use_id);
      for (const l of linhas) {
        for (const b of Array.isArray(l.message?.content) ? l.message.content : []) {
          if (l.type === 'assistant' && b.type === 'text') textos.push(b.text);
          if (l.type === 'assistant' && b.type === 'tool_use') {
            chamadas.push({ nome: b.name, entrada: b.input, negada: negadas.has(b.id), turnoDeStatus: false, ts: l.timestamp ?? null });
            if (b.name === 'Agent') despachos.push({ papel: null, prompt: String(b.input?.prompt ?? ''), aprendizados: [] });
          }
        }
      }
    }
  }
  // LIMITE: `turnoDeStatus` fica falso (o `.exp` não anota qual envio é pergunta de status): 8b só vê Agent negado, sem separar o turno
  const perguntas = estados.map(({ n, estado }) => ({ ponto: n, rotulo: roteiro.falas.find((f) => f.n === n)?.rotulo ?? '—', abriuPergunta: estado.pergunta != null, botoes: Array.isArray(estado.pergunta?.opcoes) && estado.pergunta.opcoes.length >= 2 }));
  const integradas = eventos.filter((e) => e.tipo === 'task.integrada').map((e) => e.dados?.task).filter(Boolean);
  const ult = estados.at(-1)?.estado;
  const agoraAgentes = Array.isArray(ult?.agora?.agentes) ? ult.agora.agentes : [];
  const equipe = (Array.isArray(ult?.equipe?.agentes) ? ult.equipe.agentes : []).filter((a) => a.vivo === true);
  const detalhes = equipe.map((a) => ({ nome: a.nome, descricao: a.descricao, task: a.task, acao: agoraAgentes.find((x) => x.quem?.nome === a.nome)?.acao ?? null }));
  const ativos = (ultimo?.agentes ?? []).filter((a) => ['pending', 'running', 'waiting'].includes(a.status));
  // pouso (asserção 11): o `sessao.pouso` do diário, o "limpar a conversa" em algum quadro depois dele, os pushes do bare e os `Agent` entre o pouso e o próximo `sessao.inicio {origem: clear}`
  const pouso = eventos.find((e) => e.tipo === 'sessao.pouso');
  const clear = pouso === undefined ? undefined : eventos.find((e) => e.tipo === 'sessao.inicio' && e.dados?.origem === 'clear' && e.ts > pouso.ts);
  const pushes = existsSync(join(rundir, 'pushes.log')) ? readFileSync(join(rundir, 'pushes.log'), 'utf8').split('\n').filter(Boolean).length : 0;
  const depoisDoPouso = pouso === undefined ? [] : chamadas.filter((c) => c.nome === 'Agent' && c.ts > pouso.ts && (clear === undefined || c.ts < clear.ts));
  return {
    celula, quadros, integradas, eventos, digitadas, transcript: { chamadas, textos }, perguntas, despachos,
    entregasPublicadas: [...new Set(eventos.filter((e) => e.tipo === 'entrega.fim').map((e) => e._entrega))], gravacoes,
    vivos: { ativos: ativos.length, linhasAgente: detalhes.length, detalhes },
    pouso: { percent: Number.isFinite(pouso?.dados?.percent) ? pouso.dados.percent : 0, limparNoDepende: pouso !== undefined && quadros.some((q) => q.linhas.some((l) => /limpar a conversa/i.test(l))), pushes, despachosDepois: depoisDoPouso.length },
    panes: (ultimo?.panes ?? []).filter((p) => p.placement !== null),
  };
}

async function matriz(fonte, tmpRaiz, roteiro, so) {
  const celulas = MATRIZ.filter((c) => so === null || idDaCelula(c) === so);
  const base = join(tmpRaiz, '.claude-tmp', 'a1', String(Date.now()));
  const execucoes = [];
  for (const celula of celulas) {
    const rundir = join(base, idDaCelula(celula));
    const repo = join(rundir, 'repo');
    mkdirSync(join(rundir, 'obs'), { recursive: true });
    const { bin } = prepararCopia(fonte, repo, celula);
    escreverObservador(join(rundir, 'observador'));
    writeFileSync(join(rundir, 'inicio.iso'), `${new Date().toISOString()}\n`);
    writeFileSync(join(rundir, 'falas.tsv'), roteiro.falas.map((f) => `${f.n}\t${f.rotulo}\t${sha256(f.texto)}\t${f.texto}`).join('\n'));
    const r = spawnSync('expect', ['-f', join(AQUI, 'a1.exp'), rundir, repo, PLUGIN, join(rundir, 'observador'), String(celula.cols), String(celula.rows), bin, process.execPath, fileURLToPath(import.meta.url)], { encoding: 'utf8', timeout: 4 * 60 * 60 * 1000 });
    let ev = null;
    try { ev = await coletar(rundir, repo, celula, roteiro); } catch (e) { process.stderr.write(`${idDaCelula(celula)}: coleta falhou: ${e.message}\n`); }
    const exec = ev === null || r.status !== 0 ? { celula: idDaCelula(celula), passa: false, resultados: [{ id: 'execucao', ok: false, detalhe: `expect rc ${r.status}; evidência ${ev === null ? 'ausente' : 'coletada'}` }] } : avaliarExecucao(ev);
    writeFileSync(join(rundir, 'resultado.json'), `${JSON.stringify(exec, null, 2)}\n`);
    execucoes.push(exec);
  }
  return { rel: avaliarMatriz(execucoes), execucoes, base };
}

// ─── CLI ───

function flag(argv, nome) { const i = argv.indexOf(nome); return i >= 0 ? argv[i + 1] : undefined; }

export async function main(argv) {
  if (argv[0] === 'snapshot') { snapshot(argv[1], argv[2], Number(argv[3])); return 0; }
  // `topo` = a árvore que será commitada (a guarda lê o `git ls-files` dela e a cópia do A1 sai dela); `principal` = onde vivem o roteiro e o `.claude-tmp/`
  const topo = flag(argv, '--raiz') ?? git(AQUI, 'rev-parse', '--show-toplevel').trim();
  const principal = flag(argv, '--raiz') ?? raizPrincipal(AQUI);
  const arqPontos = flag(argv, '--pontos') ?? PONTOS_ARQ;
  const arqRoteiro = flag(argv, '--roteiro') ?? join(principal, ROTEIRO_REL);
  const modo = argv.find((a) => ['--guarda', '--gerar', '--matriz'].includes(a));
  if (modo === undefined) { process.stderr.write('uso: rodar-a1.mjs --guarda | --gerar | --matriz [--so <celula>] [--roteiro <arq>]\n'); return 2; }
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
  process.stdout.write(`guarda das falas: 0 achados (${g.conferidas} falas ≥ ${MIN_FALA} caracteres em ${g.arquivos} arquivos versionados)\n`);
  if (modo === '--guarda') return 0;
  if (modo === '--gerar') { const r = gerar(topo, principal, roteiro); process.stdout.write(`pontos.json: ${r.pontos} pontos gerados pelo produto\n`); return 0; }
  const m = await matriz(topo, principal, roteiro, flag(argv, '--so') ?? null);
  for (const l of m.rel.linhas) process.stdout.write(`${l.passa ? 'PASSA' : 'FALHA'} ${l.celula} ${l.motivo}\n`);
  process.stdout.write(`A1: ${m.rel.passou}/${m.rel.total} (passa = 8/8)\nevidência em ${m.base}\n`);
  return m.rel.ok ? 0 : 1;
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { process.stderr.write(`${e.stack ?? e}\n`); process.exit(1); });
}

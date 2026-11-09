#!/usr/bin/env node
/**
 * Aceites da E3 (GM-11 T15): monta o repo descartável, informa o estado ao `aceite-e3.exp` e lê as evidências. Só lê o que o aceite produziu:
 * diário (do núcleo), transcripts e o `debug.log` do Claude Code. A tela nunca é evidência. Diário ilegível ou ferramenta falhando reprova.
 *
 *   avaliar-e3.mjs montar <sombra|emenda|entrega> <destino> <plugin-root>   repo descartável (recusa destino existente; nunca apaga)
 *   avaliar-e3.mjs estado <repo> <rundir> <plugin-root> <modo>              uma linha JSON, para o .exp decidir quando digitar e parar
 *   avaliar-e3.mjs relatorio <1|2|3|4> <repo> <rundir> <plugin-root>        evidência medida e veredito (VERDE | NAO_PROVADO | REPROVADO)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { diario, pastaTranscripts, proxima } from './avaliar.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PERGUNTA = 'A função soma aceita números negativos?';

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=aceite@example.invalid', '-c', 'user.name=Aceite GM-99', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const SPEC = `# GM-99: duas funções pequenas (repositório descartável de aceite da E3)

Módulos ES (\`export function\`). Cada task entrega o módulo e o teste do módulo (\`node:test\`, \`node:assert/strict\`), em TDD.

Domínio: inteiros de -20 a 20. Fora dele o comportamento não é requisito.

**REQ-A-1** \`src/a.mjs\` exporta \`soma(a, b)\` e devolve a + b, para qualquer par do domínio (negativos incluídos). Teste em \`test/a.test.mjs\`.

**REQ-B-1** \`src/b.mjs\` exporta \`dobro(n)\` e devolve n + n em todo o domínio. Teste em \`test/b.test.mjs\`.

Não há CI nem repositório remoto: o passo de CI não se aplica.
`;

function loopCli(repo, plugin, script, args) {
  const r = spawnSync(process.execPath, [join(plugin, 'gates', 'scripts', script), ...args, '--entrega', 'GM-99'], { cwd: repo, encoding: 'utf8' });
  let j = null;
  try { j = JSON.parse(r.stdout.trim().split('\n').at(-1)); } catch { /* fica null */ }
  if (j?.ok !== true) throw new Error(`${script} ${args.join(' ')}: rc ${r.status} ${r.stdout} ${r.stderr}`);
  return j;
}

function montar(modo, destino, plugin) {
  if (!['sombra', 'emenda', 'entrega'].includes(modo)) throw new Error(`modo ${modo}`);
  const dest = resolve(destino);
  const plano = modo === 'entrega' ? join(dest, '..', `plano-${modo}.json`) : join(AQUI, 'plano-e3.json');
  if (modo === 'entrega') {
    mkdirSync(dirname(plano), { recursive: true });
    const p = JSON.parse(readFileSync(join(AQUI, 'plano-e3.json'), 'utf8'));
    p.tasks = [{ id: 'T1', deps: [], arquivos: ['src/a.mjs', 'test/a.test.mjs'], reqs: ['REQ-A-1'], mutacoes: '.harness/entregas/GM-99/mutacoes-t1.json' }];
    writeFileSync(plano, JSON.stringify(p));
  }
  execFileSync('bash', [join(AQUI, 'montar-repo.sh'), dest, plano], { stdio: 'inherit' });
  writeFileSync(join(dest, 'docs', 'spec-gm99.md'), SPEC);
  const cfg = JSON.parse(readFileSync(join(dest, 'harness.config.json'), 'utf8'));
  if (modo === 'entrega') {
    const marcas = join(dirname(dest), 'marcas');
    mkdirSync(marcas, { recursive: true });
    mkdirSync(join(dest, 'fake'));
    const corpos = { deploy: 'touch "$M/deploy"', smoke: 'touch "$M/smoke"\nexit 1', rollback: 'touch "$M/rollback"' };
    for (const [n, c] of Object.entries(corpos)) writeFileSync(join(dest, 'fake', `${n}.sh`), `M='${marcas}'\necho "$0" >> "$M/exec.log"\n${c}\n`);
    const comandos = {};
    for (const n of Object.keys(corpos)) comandos[n] = { argv: ['bash', join(dest, 'fake', `${n}.sh`)], timeout_s: 30 };
    cfg.entrega = { politica: 'continua', base: 'enabler/GM-99-aceite', comandos };
  }
  writeFileSync(join(dest, 'harness.config.json'), `${JSON.stringify(cfg, null, 2)}\n`);
  git(dest, 'add', '-A');
  git(dest, 'commit', '-q', '-m', 'chore(GM-99): spec com REQ-A-1 e REQ-B-1');
  if (modo === 'emenda') {
    writeFileSync(join(dest, '.harness', 'emenda.diff'), '+ **REQ-A-1** `src/a.mjs` exporta `soma(a, b)` e devolve a + b; se um argumento não for número inteiro, lança `TypeError`.\n');
    loopCli(dest, plugin, 'loop.mjs', ['emenda', 'propor', '--req', 'REQ-A-1', '--task', 'T1', '--diff', join(dest, '.harness', 'emenda.diff'), '--fato', 'o dono quer validação de tipo', '--alternativa', 'não validar', '--evidencia', 'pedido do dono no aceite', '--causa', 'regra_negocio']);
  }
  if (modo === 'entrega') {
    const bare = join(dirname(dest), 'origin.git');
    mkdirSync(bare);
    git(bare, 'init', '-q', '--bare', '-b', 'enabler/GM-99-aceite');
    git(dest, 'remote', 'add', 'origin', bare);
    git(dest, 'push', '-q', 'origin', 'enabler/GM-99-aceite');
    git(dest, 'remote', 'set-head', 'origin', 'enabler/GM-99-aceite');
    const L = (...a) => loopCli(dest, plugin, 'loop.mjs', a);
    L('abrir', 'T1'); L('iniciar', 'T1', 'implementador');
    const wt = join(dest, '.harness', 'worktrees', 'T1');
    mkdirSync(join(wt, 'src'), { recursive: true });
    writeFileSync(join(wt, 'src', 'a.mjs'), 'export const soma = (a, b) => a + b;\n');
    mkdirSync(join(wt, 'test'), { recursive: true });
    writeFileSync(join(wt, 'test', 'a.test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { soma } from '../src/a.mjs';\ntest('soma', () => assert.equal(soma(2, -3), -1));\n");
    git(wt, 'add', 'src/a.mjs', 'test/a.test.mjs');
    git(wt, 'commit', '-q', '-m', 'feat(GM-99): T1 (preparo do aceite, sem LLM)');
    L('concluir', 'T1'); L('iniciar', 'T1', 'revisor'); L('veredito', 'T1', 'APROVADO', '1', '0', '0'); L('integrar', 'T1');
    L('ci', 'verde', '--alvo', 'homolog');
  }
  console.log(`repo pronto: ${dest} (${modo})`);
}

// ─────────────────────────────────────────────────────────────── leitura

/** Arquivos .jsonl de transcript da sessão (inclui subagents), com o mtime mais novo. */
function transcripts(repo) {
  const pasta = pastaTranscripts(repo, homedir());
  const achados = [];
  const andar = (d) => {
    if (!existsSync(d)) return;
    for (const n of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, n.name);
      if (n.isDirectory()) andar(p);
      else if (n.name.endsWith('.jsonl')) achados.push(p);
    }
  };
  andar(pasta);
  return { pasta, achados, mtime: achados.reduce((m, f) => Math.max(m, statSync(f).mtimeMs), 0) };
}

const sessoesDoDiario = (ev) => [...new Set(ev.map((e) => e.sessao))].filter((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(String(s)));

/** Problemas de leitura dos transcripts: `ausentes` (sessão do diário sem arquivo) e `ilegiveis` (arquivo ⇒ nº de linhas que não são JSON). Ausente ≠ corrompido. */
const novosProblemas = () => ({ ausentes: new Set(), ilegiveis: new Map() });

/** Objetos de um transcript. Arquivo ausente ⇒ `[]` e registrado em `prob.ausentes`; linha ilegível ⇒ registrada em `prob.ilegiveis` (nunca descartada em silêncio). */
function lerTranscript(arquivo, prob) {
  if (!existsSync(arquivo)) { prob.ausentes.add(arquivo); return []; }
  const objs = [];
  let ruins = 0;
  for (const l of readFileSync(arquivo, 'utf8').split('\n').filter(Boolean)) {
    try { objs.push(JSON.parse(l)); } catch { ruins += 1; }
  }
  if (ruins > 0) prob.ilegiveis.set(arquivo, ruins); else prob.ilegiveis.delete(arquivo);
  return objs;
}

/** Mensagens do assistente agrupadas por `message.id` (cada bloco é uma linha do transcript). */
function mensagens(arquivo, prob) {
  const porId = new Map();
  for (const o of lerTranscript(arquivo, prob)) {
    if (o.type !== 'assistant' || !o.message?.id) continue;
    const m = porId.get(o.message.id) ?? { id: o.message.id, ts: o.timestamp, blocos: [] };
    for (const b of o.message.content ?? []) if (b.type === 'tool_use') m.blocos.push({ nome: b.name, input: b.input ?? {} });
    porId.set(o.message.id, m);
  }
  return [...porId.values()];
}

/** Blocos `Agent` do ORQUESTRADOR (transcripts de sessão, não de subagent), sem repetir `message.id`. */
function agentes(repo, ev, prob) {
  const { pasta } = transcripts(repo);
  const out = [];
  for (const sid of sessoesDoDiario(ev)) {
    for (const m of mensagens(join(pasta, `${sid}.jsonl`), prob)) {
      for (const b of m.blocos) if (b.nome === 'Agent' || b.nome === 'Task') out.push({ ts: m.ts, tipo: String(b.input.subagent_type ?? ''), modelo: b.input.model ?? null });
    }
  }
  return out;
}

/** Resultados de Bash cujo comando contém `trecho`, na ordem do transcript: o texto devolvido ao modelo. */
function resultadosBash(repo, ev, trecho, prob) {
  const { pasta } = transcripts(repo);
  const out = [];
  for (const sid of sessoesDoDiario(ev)) {
    const usos = new Map();
    for (const o of lerTranscript(join(pasta, `${sid}.jsonl`), prob)) {
      const c = o.message?.content;
      if (!Array.isArray(c)) continue;
      for (const b of c) {
        if (b.type === 'tool_use' && b.name === 'Bash' && String(b.input?.command ?? '').includes(trecho)) usos.set(b.id, String(b.input.command));
        if (b.type === 'tool_result' && usos.has(b.tool_use_id)) out.push({ comando: usos.get(b.tool_use_id), texto: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) });
      }
    }
  }
  return out;
}

const tiposDe = (ev) => ev.map((e) => e.tipo);

async function estado(repo, rundir, plugin, modo) {
  const dia = await diario(repo, plugin);
  const ev = dia.ok ? dia.eventos : [];
  const t = transcripts(repo);
  const dMtime = dia.ok && existsSync(dia.dir) ? Math.max(0, ...readdirSync(dia.dir).map((n) => statSync(join(dia.dir, n)).mtimeMs)) : 0;
  const idle = t.achados.length === 0 ? 0 : Math.round((Date.now() - Math.max(t.mtime, dMtime)) / 1000);
  const p = dia.ok ? proxima(repo, plugin, 0) : { ok: false };
  const n = (tipo) => ev.filter((e) => e.tipo === tipo).length;
  const integradas = ev.filter((e) => e.tipo === 'task.integrada').map((e) => e.dados.task);
  const out = {
    eventos: dia.ok ? ev.length : -1, idle_s: idle, transcripts: t.achados.length, acao: p.ok ? p.tipo : 'erro', motivo: p.ok ? (p.acao?.motivo ?? null) : null,
    decisoes: n('decisao.sombra'), consultas: n('sombra.consulta'), agentes_sombra: dia.ok ? agentes(repo, ev, novosProblemas()).filter((a) => /gabarito-sombra$/.test(a.tipo)).length : 0,
    integradas, emendada: n('spec.emendada'), fim_entrega: n('entrega.fim'), parar: n('loop.parar'),
  };
  // `fim`: o que cada modo precisa ter acontecido para o aceite poder encerrar (o .exp ainda espera `idle_s`)
  if (modo === 'sombra') out.fim = out.decisoes >= 1 && resultadosBash(repo, ev, 'sombra.mjs', novosProblemas()).filter((r) => /"cache":\s*true/.test(r.texto)).length >= 1;
  if (modo === 'emenda') { out.espera_emenda = out.acao === 'esperar' && out.motivo === 'emenda' && integradas.includes('T2') && out.emendada === 0; out.fim = out.acao === 'concluir' && out.emendada === 1; }
  if (modo === 'entrega') out.fim = out.fim_entrega >= 1;
  console.log(JSON.stringify(out));
}

const veredito = (falhas, naoProvado = []) => (falhas.length > 0 ? 'REPROVADO' : naoProvado.length > 0 ? 'NAO_PROVADO' : 'VERDE');
const saida = (o) => { console.log(JSON.stringify(o, null, 1)); if (o.veredito !== 'VERDE') process.exitCode = 1; };

async function relatorio(qual, repo, rundir, plugin) {
  const dia = await diario(repo, plugin);
  if (!dia.ok) return saida({ aceite: qual, veredito: 'REPROVADO', motivo: dia.motivo });
  const ev = dia.eventos;
  const n = (t) => ev.filter((e) => e.tipo === t).length;
  const exp = existsSync(join(rundir, 'exp.status')) ? readFileSync(join(rundir, 'exp.status'), 'utf8').trim() : 'sem exp.status';
  const falhas = [];
  const naoProvado = [];
  // sessão que não terminou (TRAVADO) ou que o .exp marcou não provada: a evidência pode estar incompleta, não reprovada
  if (/^(NAO_PROVADO|TRAVADO)/.test(exp)) naoProvado.push(`exp.status ${exp}`);
  const debug = existsSync(join(rundir, 'debug.log')) ? readFileSync(join(rundir, 'debug.log'), 'utf8').split('\n') : [];
  const stopLinhas = debug.filter((l) => /"Hook Stop \(Stop\) success/.test(l));
  const bloqueio = debug.find((l) => /Auto mode classifier blocked action/.test(l));
  const prob = novosProblemas();
  const ag = agentes(repo, ev, prob);
  // transcript que falta é prova que falta (NAO_PROVADO); linha ilegível é transcript corrompido (REPROVADO): nunca zero nem linha pulada (M1)
  const daTranscript = []; // falhas que só valem se o transcript foi lido: com transcript ausente viram "não provado"
  const veredictar = (falhas) => {
    if (prob.ausentes.size > 0) naoProvado.push(...daTranscript.map((f) => `sem transcript para afirmar: ${f}`));
    else falhas.push(...daTranscript);
    for (const a of [...prob.ausentes].sort()) naoProvado.push(`transcript ausente: ${a}`);
    for (const [a, n] of [...prob.ilegiveis].sort()) falhas.push(`transcript ilegível: ${a} tem ${n} ${n === 1 ? 'linha' : 'linhas'} que não ${n === 1 ? 'é' : 'são'} JSON`);
    return veredito(falhas, naoProvado);
  };
  const sombras = ag.filter((a) => /gabarito-sombra$/.test(a.tipo));
  const base = { aceite: qual, exp_status: exp, eventos: ev.length, tipos: tiposDe(ev).filter((t) => !/^custo|^guarda/.test(t)) };

  if (qual === '1') {
    const res = resultadosBash(repo, ev, 'sombra.mjs', prob);
    const perguntas = res.filter((r) => /perguntar/.test(r.comando));
    const cache = perguntas.filter((r) => /"cache":\s*true/.test(r.texto));
    const decisoes = ev.filter((e) => e.tipo === 'decisao.sombra');
    const out = { ...base, agentes_sombra: sombras.length, modelo_do_agent: sombras.map((a) => a.modelo), perguntar_chamadas: perguntas.length, perguntar_cache_true: cache.length, decisao_sombra: decisoes.length, consultas: n('sombra.consulta'), cache_na_2a: perguntas.length >= 2 && /"cache":\s*true/.test(perguntas.at(-1).texto) && !/"cache":\s*true/.test(perguntas[0].texto) };
    if (sombras.length !== 1) daTranscript.push(`Agent Sombra = ${sombras.length}, esperado 1`);
    if (decisoes.length !== 1) falhas.push(`decisao.sombra = ${decisoes.length}, esperado 1`);
    if (!out.cache_na_2a) daTranscript.push('a 2ª pergunta não voltou cache:true (ou a 1ª já voltou)');
    return saida({ ...out, falhas, nao_provado: naoProvado, veredito: veredictar(falhas) });
  }
  if (qual === '4') {
    const med = ev.filter((e) => e.tipo === 'custo.medicao' && String(e.agente).startsWith('subagent:'));
    const sombra = med.filter((e) => e.dados?.papel === 'sombra');
    const out = { ...base, medicoes_subagent: med.map((e) => ({ agente: String(e.agente).slice(0, 18), papel: e.dados?.papel ?? null, modelo: e.dados?.modelo ?? null, output_tokens: e.dados?.output_tokens ?? null })), medicoes_papel_sombra: sombra.length, mod_ativo_nesta_sessao: existsSync(join(rundir, 'mod.jsonl')) || debug.some((l) => /hooks module gabarito-mestre\S* loaded/.test(l)) };
    if (sombra.length < 1) falhas.push("nenhum custo.medicao com papel: 'sombra'");
    else if (!sombra.every((e) => typeof e.dados.modelo === 'string' && e.dados.modelo !== '')) falhas.push('custo.medicao de Sombra sem modelo');
    return saida({ ...out, falhas, nao_provado: naoProvado, veredito: veredictar(falhas) });
  }
  if (qual === '2') {
    const pos = (t, f = () => true) => ev.findIndex((e) => e.tipo === t && f(e));
    const iEm = pos('spec.emendada');
    const iPropor = pos('emenda.proposta');
    const iT2 = pos('task.integrada', (e) => e.dados.task === 'T2');
    const iT1ini = pos('task.iniciada', (e) => e.dados.task === 'T1' && e.dados.papel === 'implementador');
    const iT1 = pos('task.integrada', (e) => e.dados.task === 'T1');
    const avisosStop = stopLinhas.filter((l) => /emenda/i.test(l)).length;
    const p = proxima(repo, plugin, 0);
    const out = { ...base, emenda_proposta_idx: iPropor, t2_integrada_idx: iT2, spec_emendada_idx: iEm, spec_emendada: iEm >= 0 ? ev[iEm].dados : null, t1_implementador_idx: iT1ini, t1_integrada_idx: iT1, avisos_stop_com_emenda: avisosStop, stops_total: stopLinhas.length, acao_final: p.ok ? p.tipo : 'erro', digitacao: existsSync(join(rundir, 'sends.log')) ? readFileSync(join(rundir, 'sends.log'), 'utf8').split('\n').filter(Boolean).map((l) => l.split(' ')[1]) : [] };
    if (iEm < 0 || ev[iEm].dados.origem !== 'dono') falhas.push('sem spec.emendada com origem dono');
    if (!(iT2 >= 0 && iPropor >= 0 && iT2 > iPropor && (iEm < 0 || iT2 < iEm))) falhas.push('T2 não chegou a integrada com a proposta aberta');
    if (iT1ini >= 0 && iEm >= 0 && iT1ini < iEm) falhas.push('T1 despachada ao implementador antes da emenda aprovada');
    if (!(iT1 > iEm && iEm >= 0)) falhas.push('T1 não integrou depois da emenda');
    if (out.acao_final !== 'concluir') falhas.push(`proxima final = ${out.acao_final}, esperado concluir`);
    if (avisosStop < 1) naoProvado.push('nenhum Stop com aviso de emenda no debug.log');
    return saida({ ...out, falhas, nao_provado: naoProvado, veredito: veredictar(falhas) });
  }
  if (qual === '3') {
    const marcasDir = join(dirname(repo), 'marcas');
    const marcas = existsSync(marcasDir) ? readdirSync(marcasDir).filter((m) => m !== 'exec.log').sort() : [];
    const entregaEv = ev.filter((e) => /^entrega\.|^loop\.parar$/.test(e.tipo)).map((e) => [e.tipo, e.dados]);
    const ancora = existsSync(join(dia.dir, 'entrega.ancora'));
    const textoDiario = readdirSync(dia.dir).filter((f) => /^events\..+\.jsonl$/.test(f)).map((f) => readFileSync(join(dia.dir, f), 'utf8')).join('\n');
    const out = { ...base, marcas, entrega_eventos: entregaEv, ancora_existe: ancora, comando_no_diario: /fake\/(deploy|smoke|rollback)\.sh/.test(textoDiario) };
    if (!(marcas.includes('rollback') && marcas.includes('deploy') && marcas.includes('smoke'))) falhas.push(`marcas ${marcas.join(',')}: faltou deploy, smoke ou rollback executado`);
    if (!ev.some((e) => e.tipo === 'loop.parar' && e.dados?.motivo === 'smoke')) falhas.push('sem loop.parar{smoke}');
    if (!ev.some((e) => e.tipo === 'entrega.fim' && e.dados?.ok === false && e.dados?.motivo === 'smoke')) falhas.push('sem entrega.fim{ok:false, motivo:smoke}');
    if (!ancora) falhas.push('sem entrega.ancora');
    if (out.comando_no_diario) falhas.push('comando de deploy no diário');
    // nada rodou porque o classificador negou o deploy: o aceite não foi exercido (NAO_PROVADO), não falhou. Se algo rodou, a falha é real.
    if (bloqueio && marcas.length === 0 && entregaEv.length === 0 && !ancora) {
      naoProvado.push(`classificador de modo automático negou a ação no debug.log: ${bloqueio.replace(/^\S+\s+\[\w+\]\s+/, '')}`);
      falhas.length = 0;
    }
    return saida({ ...out, falhas, nao_provado: naoProvado, veredito: veredictar(falhas) });
  }
  throw new Error(`aceite ${qual}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...a] = process.argv.slice(2);
  try {
    if (cmd === 'montar') montar(a[0], a[1], a[2]);
    else if (cmd === 'estado') await estado(a[0], a[1], a[2], a[3]);
    else if (cmd === 'relatorio') await relatorio(a[0], a[1], a[2], a[3]);
    else throw new Error('uso: montar|estado|relatorio');
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exitCode = 2;
  }
}

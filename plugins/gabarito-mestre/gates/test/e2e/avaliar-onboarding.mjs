#!/usr/bin/env node
/**
 * Aceite do onboarding com adotante simulado (GM-13 T17b): monta 3 repos de exemplo, informa o estado ao `aceite-onboarding.exp` (quando apertar Enter,
 * quando parar) e mede. FORA de `npm test`. Sem LLM aqui: lê só o que a sessão produziu (transcript do Claude Code, harness.config.json, doctor).
 * Transcript ilegível, config inválida ou ferramenta falhando reprova ou vira NAO_PROVADO, nunca "0".
 *
 *   avaliar-onboarding.mjs montar <A|B|C> <destino> <plugin-root> [<plugin-1.1.0-root>]
 *       A: monorepo (2 pacotes, workflow de CI, origin/HEAD) · B: repo instalado com a 1.1.0 (tag gabarito-mestre--v1.1.0) + fluxo/versionamento/orquestracao 1.1.x
 *       · C: repo sem remoto. Deixa <destino>.pristino (cópia antes da sessão, base da referência).
 *   avaliar-onboarding.mjs referencia <destino> <rundir> <plugin-root>
 *       cópia do pristino + instalador + `onboarding.mjs detectar` + `gravar` com opções[0] de cada pergunta ⇒ <rundir>/ref.json (perguntas reais e config esperada)
 *   avaliar-onboarding.mjs estado <repo>        uma linha JSON (perguntas pendentes, doctor visto, fim) para o .exp
 *   avaliar-onboarding.mjs relatorio <A|B|C> <repo> <rundir> <plugin-root> [<tentativa>]   número por critério e PASSA | FALHA | NAO_PROVADO (rc 0 só se PASSA)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=aceite@example.invalid', '-c', 'user.name=Aceite Onboarding', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const jsonl = (arq) => (existsSync(arq) ? readFileSync(arq, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { _ilegivel: true }; } }) : []);
const node = (plugin, script, args, cwd, input) => {
  const r = spawnSync(process.execPath, [join(plugin, 'gates', 'scripts', script), ...args], { cwd, encoding: 'utf8', input });
  let j = null;
  try { j = JSON.parse(r.stdout.trim().split('\n').at(-1)); } catch { /* texto */ }
  return { rc: r.status, j, out: r.stdout, err: r.stderr };
};
const escreve = (dest, rel, txt) => { mkdirSync(dirname(join(dest, rel)), { recursive: true }); writeFileSync(join(dest, rel), txt); };
const CI = 'name: ci\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm test\n';

function montar(kind, destino, plugin, p110) {
  if (!['A', 'B', 'C'].includes(kind)) throw new Error('repo A, B ou C');
  const dest = resolve(destino);
  if (existsSync(dest)) throw new Error(`destino já existe: ${dest}`);
  mkdirSync(dest, { recursive: true });
  git(dest, 'init', '-q', '-b', 'main');
  escreve(dest, '.gitignore', 'node_modules/\n.harness/\n.claude-tmp/\n');
  // o plugin depende do superpowers; `--setting-sources project` só o habilita por aqui (mesmo recurso do aceite da T17)
  escreve(dest, '.claude/settings.json', `${JSON.stringify({ enabledPlugins: { 'superpowers@claude-plugins-official': true } })}\n`);
  if (kind === 'A') {
    escreve(dest, 'package.json', `${JSON.stringify({ name: 'mono-exemplo', private: true, workspaces: ['packages/*'], scripts: { test: "echo '# pass 2'" } }, null, 2)}\n`);
    for (const p of ['alfa', 'beta']) {
      escreve(dest, `packages/${p}/package.json`, `${JSON.stringify({ name: `@mono/${p}`, version: '1.0.0', main: 'index.js', scripts: { test: "echo '# pass 1'" } }, null, 2)}\n`);
      escreve(dest, `packages/${p}/index.js`, `module.exports = '${p}';\n`);
    }
    escreve(dest, '.github/workflows/ci.yml', CI);
    escreve(dest, 'README.md', 'Monorepo de exemplo do aceite do onboarding.\n');
  } else {
    escreve(dest, 'package.json', `${JSON.stringify({ name: `app-${kind.toLowerCase()}`, version: '1.0.0', private: true, scripts: { test: "echo '# pass 1'" } }, null, 2)}\n`);
    escreve(dest, 'index.js', "console.log('app');\n");
    escreve(dest, 'README.md', `Repositório ${kind} de exemplo do aceite do onboarding.\n`);
    if (kind === 'B') escreve(dest, '.github/workflows/ci.yml', CI);
  }
  git(dest, 'add', '-A');
  git(dest, 'commit', '-q', '-m', 'chore: repositorio de exemplo do aceite do onboarding');
  if (kind === 'A') {
    // origin/HEAD sem push: só as refs locais (versionamento detectado por `git symbolic-ref refs/remotes/origin/HEAD`)
    git(dest, 'remote', 'add', 'origin', 'https://example.invalid/mono-exemplo.git');
    git(dest, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(dest, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  }
  if (kind === 'B') {
    if (!p110 || !existsSync(join(p110, 'scripts', 'instalar.sh'))) throw new Error('repo B pede o plugin 1.1.0 extraído (git archive gabarito-mestre--v1.1.0)');
    const i = spawnSync('bash', [join(p110, 'scripts', 'instalar.sh'), dest], { encoding: 'utf8' });
    if (i.status !== 0) throw new Error(`instalar.sh 1.1.0: rc ${i.status} ${i.stdout} ${i.stderr}`);
    const set = (secao, obj) => {
      const r = spawnSync(process.execPath, [join(p110, 'gates', 'scripts', 'onboarding-config.mjs'), '--root', dest, '--set', secao, JSON.stringify(obj)], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`onboarding-config 1.1.0 ${secao}: ${r.stdout} ${r.stderr}`);
    };
    set('fluxo', { ferramenta: 'arquivos', mcp: null, iniciativa: { id: 'INI-1', nome: 'Iniciativa 1.1.x', url: '' }, mapeamento: { FL3: 'Iniciativa', FL2: 'Epic', FL1: 'PBI' }, status: { FL2: { preparado: 'preparado', em_execucao: 'em execução', em_validacao: 'em validação', concluido: 'concluído' }, FL1: { preparado: 'preparado', em_execucao: 'em execução', revisao: 'revisão', pronto: 'pronto', concluido: 'concluído' } }, vinculoPbiEpic: { tipo: 'frontmatter', nome: 'epic' }, escrita: false, idPadrao: '^[A-Z]+-\\d+$', ledgerDir: 'docs/ledgers', envelhecimentoDias: 3, resolvidoEm: '2026-10-01' });
    set('versionamento', { modelo: 'trunk', branchPadrao: '^(feat|fix|enabler|debt|spike|task|perf|refactor)/[A-Z]+-\\d+(-[a-z0-9-]+)?$|^(chore|docs|ci|build|test)/[a-z0-9-]+$', branchWorktree: '^wt/[A-Z]+-\\d+-\\d+$', commit: 'conventional', tiposComEscopoDePbi: ['feat', 'fix', 'enabler', 'debt', 'spike', 'task', 'perf', 'refactor'], tiposLivres: ['chore', 'docs', 'ci', 'build', 'test', 'release', 'revert'], tag: '^v\\d+\\.\\d+\\.\\d+$', changelog: 'CHANGELOG.md', resolvidoEm: '2026-10-01' });
    set('orquestracao', { modelo: { politica: 'mais-potente', alias: 'opus', resolvidoEm: '2026-10-01', validadeDias: 90 }, sempreSubagente: true, lembretePorPrompt: false, paralelismo: { modo: 'auto', simultaneos: 2, teto: 4, limites: { loadPorCoreMax: 1.5, memDisponivelMinMB: 2048, discoLivreMinGB: 5 }, arquivosDeContenda: [], isolamentoWorktree: { porta: '3000+n', dbSchema: 'wt_{n}', namespace: 'wt-{n}' }, rodadasAntesDeEscalar: 2, calibradoEm: '2026-10-01' } });
    git(dest, 'add', '-A');
    git(dest, 'commit', '-q', '-m', 'chore: instala o gabarito 1.1.x e grava o onboarding 1.1.x');
  }
  cpSync(dest, `${dest}.pristino`, { recursive: true });
  console.log(JSON.stringify({ repo: dest, kind, pristino: `${dest}.pristino`, tools: existsSync(join(dest, 'tools', 'gabarito-gates')), config: existsSync(join(dest, 'harness.config.json')) }));
}

/** Instala (como a skill faz) e detecta numa cópia do pristino; a config esperada é a de `gravar` com `opcoes[0]` de cada pergunta real. */
function referencia(destino, rundir, plugin) {
  const dest = resolve(destino);
  const pr = `${dest}.pristino`; const ref = `${dest}.ref`;
  if (!existsSync(pr)) throw new Error(`pristino ausente: ${pr}`);
  if (existsSync(ref)) throw new Error(`referência já existe: ${ref}`);
  cpSync(pr, ref, { recursive: true });
  const jaTem = ['tools/gabarito-gates', 'harness.config.json', 'AGENTS.md'].some((p) => existsSync(join(ref, p)));
  const ins = spawnSync('bash', [join(plugin, 'scripts', 'instalar.sh'), ref, ...(jaTem ? ['--atualizar'] : [])], { encoding: 'utf8' });
  if (ins.status !== 0) throw new Error(`instalar.sh na referência: rc ${ins.status} ${ins.stderr}`);
  const det = node(plugin, 'onboarding.mjs', ['detectar', '--root', ref], ref);
  if (det.j?.ok !== true) throw new Error(`detectar: ${det.out} ${det.err}`);
  const resp = { _previa: det.j.itens };
  for (const p of det.j.perguntas) resp[p.id] = p.opcoes[0].valor;
  mkdirSync(join(ref, '.claude-tmp'), { recursive: true });
  writeFileSync(join(ref, '.claude-tmp', 'respostas.json'), JSON.stringify(resp));
  const gr = node(plugin, 'onboarding.mjs', ['gravar', '--respostas', join(ref, '.claude-tmp', 'respostas.json'), '--root', ref], ref);
  if (gr.j?.ok !== true) throw new Error(`gravar na referência: ${gr.out} ${gr.err}`);
  mkdirSync(rundir, { recursive: true });
  const out = { instalouComAtualizar: jaTem, instalador: ins.stdout, perguntas: det.j.perguntas.map((p) => ({ id: p.id, texto: p.texto, padrao: p.opcoes[0] })), configRef: JSON.parse(readFileSync(join(ref, 'harness.config.json'), 'utf8')) };
  writeFileSync(join(rundir, 'ref.json'), `${JSON.stringify(out, null, 1)}\n`);
  console.log(JSON.stringify({ ok: true, perguntas: out.perguntas.map((p) => p.id), atualizar: jaTem }));
}

function pastaTranscripts(repo) {
  const cfg = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  return join(cfg, 'projects', realpathSync(repo).replace(/[^A-Za-z0-9-]/g, '-'));
}
const textoDe = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (typeof b === 'string' ? b : b?.text ?? '')).join('\n') : '');

/** Linha do tempo do transcript: perguntas feitas (AskUserQuestion), respostas, texto do assistente, chamadas de Bash e seus resultados. */
function ler(repo) {
  const pasta = pastaTranscripts(repo);
  if (!existsSync(pasta)) return { ok: false, motivo: `sem pasta de transcripts: ${pasta}` };
  const t = { ok: true, asks: [], resultados: new Map(), textos: [], bash: [], ultimo: null, ultimoMs: 0, skill: false, linhas: 0 };
  for (const n of readdirSync(pasta).filter((x) => x.endsWith('.jsonl'))) {
    const mt = statSync(join(pasta, n)).mtimeMs;
    for (const o of jsonl(join(pasta, n))) {
      if (o._ilegivel === true) return { ok: false, motivo: `linha ilegível em ${n}` };
      t.linhas += 1;
      const c = o.message?.content;
      if (o.type === 'assistant' && Array.isArray(c)) {
        t.ultimo = o; t.ultimoMs = Math.max(t.ultimoMs, mt);
        for (const b of c) {
          if (b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '') t.textos.push(b.text);
          if (b.type === 'tool_use' && b.name === 'AskUserQuestion') t.asks.push({ id: b.id, questions: b.input?.questions ?? [] });
          if (b.type === 'tool_use' && b.name === 'Bash') t.bash.push({ id: b.id, comando: String(b.input?.command ?? '') });
          if (b.type === 'tool_use' && b.name === 'Skill') t.skill = true;
        }
      }
      if (o.type === 'user' && Array.isArray(c)) for (const b of c) if (b.type === 'tool_result') t.resultados.set(b.tool_use_id, textoDe(b.content));
    }
  }
  return t;
}

function estado(repo) {
  const t = ler(repo);
  if (!t.ok) { console.log(JSON.stringify({ ok: false, motivo: t.motivo })); return; }
  const pend = t.asks.filter((a) => !t.resultados.has(a.id)).length;
  const doctor = t.bash.find((b) => /harness-doctor\.mjs/.test(b.comando));
  const doctorFeito = doctor !== undefined && t.resultados.has(doctor.id);
  const finalizou = t.ultimo !== null && Array.isArray(t.ultimo.message?.content) && !t.ultimo.message.content.some((b) => b.type === 'tool_use');
  const ocioso = t.ultimoMs > 0 && Date.now() - t.ultimoMs > 15000;
  console.log(JSON.stringify({ ok: true, asks_total: t.asks.length, asks_pendentes: pend, doctor_feito: doctorFeito ? 1 : 0, fim: doctorFeito && finalizou && ocioso && pend === 0 ? 1 : 0, skill: t.skill ? 1 : 0, linhas: t.linhas }));
}

const linha = (rotulo, valor, esperado, passa) => ({ rotulo, valor, esperado, passa });
const ehObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Remove chaves de data de gravação (`*Em`): o dia da sessão e o da referência podem diferir; o resto é comparado inteiro. */
const semDatas = (v) => (Array.isArray(v) ? v.map(semDatas) : ehObj(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => !/Em$/.test(k)).map(([k, x]) => [k, semDatas(x)])) : v);
const diferencas = (a, b, p = '') => {
  if (ehObj(a) && ehObj(b)) return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => diferencas(a[k], b[k], `${p}${p ? '.' : ''}${k}`));
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [`${p}: sessão ${JSON.stringify(a)} ≠ esperado ${JSON.stringify(b)}`];
};

/** Respostas do AskUserQuestion: `"pergunta"="rótulo"` no tool_result. Devolve [{pergunta, resposta}] na ordem das perguntas da chamada. */
function respostasDe(ask, resultado) {
  return ask.questions.map((q) => {
    const m = new RegExp(`"${String(q.question).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*=\\s*"([^"]*)"`).exec(resultado ?? '');
    return { pergunta: q.question, opcoes: (q.options ?? []).map((o) => o.label), resposta: m ? m[1] : null };
  });
}

const PEDE_COMANDO = [
  /\b(cole|colar|copie|copiar|digite|digitar)\b[^\n]{0,80}\b(comando|terminal|prompt|abaixo)\b/i,
  /\b(rode|rodar|execute|executar)\b[^\n]{0,60}\b(você|voce|no seu terminal|no terminal|manualmente)\b/i,
  /\b(rode|execute|cole|copie|digite)\b[^\n]{0,80}`[^`\n]+`/i,
  /(^|\n)\s*(\$ )?(node|bash|npm|npx|git) [^\n]*\.(mjs|sh)\b/i,
];

function relatorio(kind, repo, rundir, plugin, tentativa) {
  const t = ler(repo);
  const criterios = [];
  const dir = resolve(repo);
  if (!t.ok) { console.log(JSON.stringify({ repo: kind, veredito: 'FALHA', motivo: `transcript ilegível: ${t.motivo}`, criterios })); process.exit(1); }
  const refArq = join(rundir, 'ref.json');
  if (!existsSync(refArq)) { console.log(JSON.stringify({ repo: kind, veredito: 'NAO_PROVADO', motivo: 'sem ref.json (rode `referencia`)', criterios })); process.exit(1); }
  const ref = JSON.parse(readFileSync(refArq, 'utf8'));
  const status = existsSync(join(rundir, 'exp.status')) ? readFileSync(join(rundir, 'exp.status'), 'utf8').trim() : 'SEM_STATUS';
  let naoProvado = status.startsWith('NAO_PROVADO') || status === 'SEM_STATUS' ? status : null;
  if (!t.skill) naoProvado ??= 'a skill gabarito-instalar não foi invocada (sem tool_use Skill)';

  // 1. perguntas
  const qs = t.asks.flatMap((a) => a.questions);
  criterios.push(linha('chamadas AskUserQuestion', t.asks.length, '<= 5', t.asks.length >= 1 && t.asks.length <= 5));
  criterios.push(linha('perguntas feitas ao usuário', qs.length, '<= 5', qs.length >= 1 && qs.length <= 5));

  // 2. Enter = default em todas: a resposta é o rótulo da opção 1 (opcoes[0] das perguntas reais do `detectar`) e a config gravada é a esperada com esses defaults
  const resps = t.asks.flatMap((a) => respostasDe(a, t.resultados.get(a.id)));
  const semResposta = resps.filter((r) => r.resposta === null).length;
  const naoDefault = resps.filter((r) => r.resposta !== null && !(r.opcoes.length > 0 && r.resposta === r.opcoes[0])).length;
  criterios.push(linha('perguntas sem resposta no transcript', semResposta, 0, resps.length > 0 && semResposta === 0));
  criterios.push(linha('respostas ≠ 1ª opção (default) da pergunta feita', naoDefault, 0, resps.length > 0 && naoDefault === 0));
  const refPad = ref.perguntas.map((p) => p.padrao.rotulo);
  const feitasPad = resps.map((r) => r.opcoes[0] ?? '');
  const mesmasPerguntas = feitasPad.length === refPad.length && refPad.every((rot, i) => String(feitasPad[i]).startsWith(rot.slice(0, 40)) || String(feitasPad[i]).includes(rot.slice(0, 40)) || rot.includes(String(feitasPad[i]).replace(/ \(default\)$/, '').slice(0, 40)));
  criterios.push(linha('perguntas feitas = perguntas reais do detectar (ids/ordem)', `${feitasPad.length} feitas / ${refPad.length} reais`, 'iguais', mesmasPerguntas));
  let cfg = null;
  const cfgArq = join(dir, 'harness.config.json');
  try { cfg = JSON.parse(readFileSync(cfgArq, 'utf8')); } catch (e) { cfg = { _erro: String(e.message) }; }
  const dif = cfg._erro ? [cfg._erro] : diferencas(semDatas(cfg), semDatas(ref.configRef));
  criterios.push(linha('config gravada ≠ config esperada com opcoes[0] (sem *Em)', dif.length, 0, dif.length === 0));

  // 3. nenhuma mensagem pedindo para colar/copiar/digitar comando (texto do assistente + texto das perguntas e opções)
  const visivel = [...t.textos, ...qs.map((q) => `${q.question}\n${(q.options ?? []).map((o) => `${o.label} ${o.description ?? ''}`).join('\n')}`)];
  const achados = visivel.flatMap((x) => PEDE_COMANDO.map((re) => re.exec(x)).filter(Boolean).map((m) => m[0].trim().slice(0, 140)));
  criterios.push(linha('mensagens pedindo comando ao usuário', achados.length, 0, achados.length === 0));

  // 4. config válida + doctor --json no fim
  const gravada = !cfg._erro && ehObj(cfg.fluxo) && typeof cfg.fluxo.resolvidoEm === 'string' && ehObj(cfg.onboarding) && ehObj(cfg.orquestracao);
  criterios.push(linha('harness.config.json válido, com fluxo.resolvidoEm, onboarding e orquestracao', gravada ? 'sim' : `não (${cfg._erro ?? 'seção ausente'})`, 'sim', gravada));
  const d = node(plugin, 'harness-doctor.mjs', ['--json'], dir);
  let doc = null;
  try { doc = JSON.parse(d.out); } catch { /* abaixo */ }
  // ONB: o que o onboarding consegue gravar. `iniciativa-resolvida` é atestado nominal (nível 2): reportado à parte, não reprova o veredito (decisão explícita do implementador, ver relatório)
  const ONB = ['fluxo-configurado', 'paralelismo-calibrado', 'modelo-resolvido', 'versionamento'];
  if (doc === null || !Array.isArray(doc.resultados)) {
    criterios.push(linha('doctor --json', `ilegível (rc ${d.rc})`, 'JSON', false));
  } else {
    const faltaOnb = doc.resultados.filter((r) => ONB.includes(r.id) && r.found === false);
    criterios.push(linha(`FALTA de onboarding no doctor (${ONB.join(', ')})`, faltaOnb.length === 0 ? 0 : `${faltaOnb.length}: ${faltaOnb.map((r) => r.id).join(',')}`, 0, faltaOnb.length === 0));
    const cmd = /\b(node|bash|npm|npx|git)\b[^\n]*|\.mjs\b|\.sh\b|\brode\b/i;
    const ini = doc.resultados.filter((r) => r.id === 'iniciativa-resolvida' && r.found === false);
    const comCmd = [...faltaOnb, ...ini].filter((r) => cmd.test(`${r.fix ?? ''} ${r.label ?? ''} ${r.evidence ?? ''}`));
    criterios.push(linha('comando para colar em fix/label/evidência (FALTA de onboarding + iniciativa-resolvida)', comCmd.length, 0, comCmd.length === 0));
    criterios.push(linha('INFORMATIVO iniciativa-resolvida (atestado nominal, nível 2; o onboarding não o atesta)', ini.length === 0 ? 'ok' : `FALTA: ${ini[0].fix}`, 'ok', true));
    ref.doctorGeral = { faltas: doc.resultados.filter((r) => r.found === false).length, total: doc.resultados.length };
  }

  // 5. (B) hooks de versionamento e config 1.1.x como default
  let extra = null;
  if (kind === 'B') {
    const ins = t.bash.find((b) => /instalar\.sh/.test(b.comando));
    const sai = ins ? (t.resultados.get(ins.id) ?? '') : '';
    const avisoHooks = sai.split('\n').filter((l) => /hook/i.test(l) && /versionamento|NÃO instalados|anterior/i.test(l)).length;
    const linhasRepasse = (t.textos.at(-1) ?? '').split('\n').filter((l) => /hook/i.test(l) && /versionamento/i.test(l)); // mensagem final ao usuário
    extra = { instalador_avisos_hooks: avisoHooks, linhas_repasse: linhasRepasse.length };
    criterios.push(linha('aviso de hooks de versionamento: do instalador → repassado em 1 linha', avisoHooks === 0 ? 'N/A (instalador não avisou)' : `${linhasRepasse.length} linha(s)`, avisoHooks === 0 ? 'N/A' : '1', avisoHooks === 0 ? true : linhasRepasse.length === 1));
    const fx = JSON.parse(readFileSync(join(`${dir}.pristino`, 'harness.config.json'), 'utf8'));
    const perdeu = ['fluxo', 'versionamento'].flatMap((k) => diferencas(semDatas(fx[k]), semDatas(Object.fromEntries(Object.keys(fx[k]).map((c) => [c, cfg[k]?.[c]]))), k));
    criterios.push(linha('config 1.1.x preservada (valores de fluxo e versionamento do pristino mantidos, exceto *Em)', perdeu.length === 0 ? 'mantidos' : perdeu.join(' | '), 'mantidos', perdeu.length === 0));
    const op = fx.orquestracao?.modelo?.alias; const os = cfg.orquestracao?.modelo?.alias;
    extra.orquestracao_modelo_alias = `${op} → ${os}`;
  }

  // 6. tempo e tentativas
  const exp = existsSync(join(rundir, 'exp.log')) ? readFileSync(join(rundir, 'exp.log'), 'utf8').split('\n').filter(Boolean) : [];
  const tempos = exp.map((l) => Number(l.split(' ')[0])).filter((n) => Number.isFinite(n));
  const seg = tempos.length >= 2 ? tempos.at(-1) - tempos[0] : null;
  const falhou = criterios.filter((c) => !c.passa);
  const veredito = falhou.length > 0 ? 'FALHA' : naoProvado !== null ? 'NAO_PROVADO' : 'PASSA';
  console.log(JSON.stringify({ repo: kind, tentativa: Number(tentativa ?? 1), veredito, exp_status: status, naoProvado, tempo_s: seg, criterios, pedidos_de_comando: achados, diferencas_de_config: dif, extra, doctor: ref.doctorGeral ?? null }, null, 1));
  process.exit(veredito === 'PASSA' ? 0 : 1);
}

const [cmd, ...a] = process.argv.slice(2);
try {
  if (cmd === 'montar') montar(a[0], a[1], a[2], a[3]);
  else if (cmd === 'referencia') referencia(a[0], a[1], a[2]);
  else if (cmd === 'estado') estado(a[0]);
  else if (cmd === 'relatorio') relatorio(a[0], a[1], a[2], a[3], a[4]);
  else { console.error('uso: avaliar-onboarding.mjs montar|referencia|estado|relatorio ...'); process.exit(2); }
} catch (e) { console.error(String(e.message ?? e)); process.exit(1); }

/**
 * Skill sem comando em variável (GM-10, REQ-LOOP-3, D-1).
 * Em zsh, `$VAR` com argumentos não separa palavras: `L="node --version"; $L` dá exit 127.
 * Texto de skill, agente, comando, reference e template usa o comando inteiro.
 *
 * MUTAÇÕES PRESCRITAS (JSON em .superpowers/sdd/2026-11-03-e2-loop/task-29-mut.json):
 *  M1  volta `LOOP=` e `$LOOP proxima` ⇒ `skills-sem-comando-em-variavel` falha
 *  M2  só `$LOOP reabrir` na linha 48 ⇒ `skills-sem-comando-em-variavel` falha
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function md(dir, recursivo) {
  const base = join(PLUGIN, dir);
  if (!existsSync(base)) return [];
  const out = [];
  const anda = (d) => {
    for (const nome of readdirSync(d)) {
      const p = join(d, nome);
      if (statSync(p).isDirectory()) { if (recursivo) anda(p); }
      else if (dir === 'templates' || nome.endsWith('.md')) out.push(p);
    }
  };
  anda(base);
  return out;
}

const ARQUIVOS = [
  ...md('skills', true), ...md('agents', false), ...md('commands', false),
  ...md('reference', false), ...md('templates', true),
];

const ATRIBUICAO = /^\s*[A-Z_]{2,}="?[a-z]+ /;
const USO = /\$[A-Z_]{2,} +[a-z<-]/;

test('skills-sem-comando-em-variavel', () => {
  assert.ok(ARQUIVOS.length > 0, 'nenhum arquivo varrido');
  const achados = [];
  for (const f of ARQUIVOS) {
    readFileSync(f, 'utf8').split('\n').forEach((linha, i) => {
      if (ATRIBUICAO.test(linha) || USO.test(linha)) achados.push(`${relative(PLUGIN, f)}:${i + 1}: ${linha.trim()}`);
    });
  }
  assert.deepEqual(achados, [], `comando em variável (zsh não separa $VAR):\n${achados.join('\n')}`);
});

test('regex-pega-o-que-deve-e-poupa-o-legitimo', () => {
  for (const ruim of ['LOOP="node x.mjs"', '$LOOP proxima --vivos 1', '$LOOP reabrir <task>', '  CMD=node foo']) {
    assert.ok(ATRIBUICAO.test(ruim) || USO.test(ruim), ruim);
  }
  for (const bom of ['cd "$TMPDIR" && ls', 'TMPDIR=/x/y', 'export PORT=3000', 'use $HOME/bin', '${CLAUDE_PLUGIN_ROOT}/x']) {
    assert.ok(!ATRIBUICAO.test(bom) && !USO.test(bom), bom);
  }
});

// ---- Costura (P9): o comando da skill roda de verdade no shell, com a raiz do plugin com espaço no caminho.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';

const FONTES = ['skills/gabarito-loop/SKILL.md', 'skills/gabarito-conformidade/SKILL.md', 'commands/gabarito.md'];
const CMD_LOOP = /node "?\$\{CLAUDE_PLUGIN_ROOT\}\/gates\/scripts\/loop\.mjs"?[^`\n]*/g;

/** Todo `node ${CLAUDE_PLUGIN_ROOT}/gates/scripts/<x>.mjs` das fontes: o caminho precisa estar entre aspas. */
function extrairComandosLoop(ref = '1:1') {
  const out = [];
  for (const rel of FONTES) {
    for (const m of readFileSync(join(PLUGIN, rel), 'utf8').matchAll(CMD_LOOP)) {
      // Placeholders viram valores de forma válida (`<E|A>` ⇒ E); o que sobrar vira `x`, senão `<`/`>` são redirecionamento no shell.
      const cmd = m[0].replace(/\s+#.*$/, '').replace(/<E\|A>/g, 'E').replace(/<sessao>:<seq>/g, ref)
        .replace(/<n>/g, '1').replace(/<tipo>/g, 'ideia').replace(/<task>/g, 'T1').replace(/<[^<>]*>/g, 'x').trim();
      out.push({ rel, cmd });
    }
  }
  return out;
}

function shellsDisponiveis() {
  return ['bash', 'zsh'].filter((sh) => spawnSync(sh, ['-c', 'exit 0']).status === 0);
}

test('comando-da-skill-roda-de-verdade-em-bash-e-zsh', () => {
  const cmds = extrairComandosLoop();
  assert.ok(cmds.length >= 2, `extração achou ${cmds.length} comando(s) do loop.mjs; esperado >= 2`);
  const subs = cmds.map((c) => c.cmd.match(/loop\.mjs"?\s+(\S+)/)?.[1]);
  assert.ok(subs.includes('proxima') && subs.includes('reabrir'), `subcomandos achados: ${subs}`);
  const shells = shellsDisponiveis();
  assert.ok(shells.includes('bash'), 'bash ausente');
  const base = mkdtempSync(join(tmpdir(), 'skills-shell-'));
  const raiz = join(base, 'raiz com espaco');
  mkdirSync(raiz);
  symlinkSync(PLUGIN, join(raiz, 'plugin'));
  const repo = join(base, 'repo');
  mkdirSync(repo);
  assert.equal(spawnSync('git', ['init', '-q', repo]).status, 0);
  for (const sh of shells) {
    for (const { rel, cmd } of cmds) {
      const r = spawnSync(sh, ['-c', cmd], {
        cwd: repo, encoding: 'utf8',
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: join(raiz, 'plugin') },
      });
      const ctx = `${sh} ${rel}: ${cmd}\nrc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`;
      assert.notEqual(r.status, 127, `comando não encontrado\n${ctx}`);
      assert.ok(!/Cannot find module/.test(r.stderr), `script não achado\n${ctx}`);
      let j;
      try { j = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { assert.fail(`saída sem JSON\n${ctx}`); }
      assert.equal(typeof j.ok, 'boolean', ctx);
      assert.notEqual(j.erro, 'uso', `subcomando caiu em uso\n${ctx}`);
    }
  }
});

// ---- GM-13 T15 r2: os comandos de aprendizado da skill, como escritos, gravam de verdade (entrega e evento reais; D, M e nada).
import { writeFileSync } from 'node:fs';
import * as diario from '../dist/diario.js';

function repoComEntrega() {
  const dir = mkdtempSync(join(tmpdir(), 'skills-apr-'));
  const g = (...a) => assert.equal(spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).status, 0, a.join(' '));
  g('init', '-q', '-b', 'enabler/GM-10-loop');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'README.md'), 'x\n');
  g('add', '-A'); g('commit', '-q', '-m', 'base');
  const entrega = join(dir, '.harness', 'entregas', 'GM-10');
  mkdirSync(entrega, { recursive: true });
  writeFileSync(join(entrega, 'plano.json'), JSON.stringify({ entrega: 'GM-10', tasks: [{ id: 'T1', deps: [], arquivos: ['a'] }] }));
  [['ci.resultado', { verde: true }], ['loop.parar', { motivo: 'ci_vermelho' }]].forEach(([tipo, dados], i) => {
    const r = diario.append(entrega, 'loop', { ts: new Date(Date.UTC(2026, 0, 1, 0, 0, i + 1)).toISOString(), autor: 't@t', sessao: 'loop', agente: 'orquestrador', tipo, dados });
    assert.ok(r.ok, JSON.stringify(r));
  });
  return dir;
}

test('comandos-de-aprendizado-da-skill-gravam-de-verdade-D-M-e-nada', () => {
  const cmds = extrairComandosLoop('loop:2').filter((c) => c.rel === 'skills/gabarito-loop/SKILL.md' && /loop\.mjs"? aprendizado /.test(c.cmd));
  const formas = cmds.map((c) => c.cmd.match(/aprendizado (E [DM]|nada)/)[1]);
  assert.deepEqual(formas, ['E M', 'E D', 'nada'], `comandos de aprendizado na skill: ${formas}`);
  const base = mkdtempSync(join(tmpdir(), 'skills-apr-raiz-'));
  const raiz = join(base, 'raiz com espaco');
  mkdirSync(raiz);
  symlinkSync(PLUGIN, join(raiz, 'plugin'));
  for (const sh of shellsDisponiveis()) {
    for (const { cmd } of cmds) {
      const repo = repoComEntrega();
      const r = spawnSync(sh, ['-c', cmd], { cwd: repo, encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: join(raiz, 'plugin') } });
      const ctx = `${sh}: ${cmd}\nrc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`;
      const j = JSON.parse(r.stdout.trim().split('\n').pop());
      assert.equal(j.ok, true, ctx);
      assert.equal(r.status, 0, ctx);
      const nada = /aprendizado nada/.test(cmd);
      const ultimo = diario.ler(join(repo, '.harness', 'entregas', 'GM-10')).at(-1);
      assert.equal(ultimo.tipo, nada ? 'aprendizado.nada' : 'aprendizado', ctx);
      if (!nada) assert.equal(ultimo.dados.status, / E D --regra/.test(cmd) ? 'D' : 'M', ctx);
    }
  }
});

// ---- Costura (P9, GM-12 T13): o comando do painel que a skill manda rodar no topo do status resolve e executa.
test('comando-do-painel-da-skill-roda-em-bash-e-zsh', () => {
  const cmd = readFileSync(join(PLUGIN, 'skills/gabarito-loop/SKILL.md'), 'utf8')
    .match(/node "\$\{CLAUDE_PLUGIN_ROOT\}\/gates\/scripts\/painel\.mjs" texto[^`\n]*/)?.[0];
  assert.ok(cmd, 'a skill não cita `painel.mjs texto`');
  const base = mkdtempSync(join(tmpdir(), 'skills-painel-'));
  const raiz = join(base, 'raiz com espaco');
  mkdirSync(raiz);
  symlinkSync(PLUGIN, join(raiz, 'plugin'));
  const repo = join(base, 'repo');
  mkdirSync(repo);
  assert.equal(spawnSync('git', ['init', '-q', repo]).status, 0);
  for (const sh of shellsDisponiveis()) {
    const r = spawnSync(sh, ['-c', cmd], {
      cwd: repo, encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: join(raiz, 'plugin') },
    });
    const ctx = `${sh}: ${cmd}\nrc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`;
    assert.notEqual(r.status, 127, `comando não encontrado\n${ctx}`);
    assert.ok(!/Cannot find module/.test(r.stderr), `script não achado\n${ctx}`);
    // Sem entrega inferida o CLI responde JSON com erro; o que não pode é cair em uso (flag mal formada).
    const ultima = r.stdout.trim().split('\n').pop() ?? '';
    if (ultima.startsWith('{')) assert.notEqual(JSON.parse(ultima).erro, 'uso', `flag caiu em uso\n${ctx}`);
  }
});

// ---- GM-13 T15: a skill do loop cita o aprendizado, o pouso sem mod e o registro; a conformidade lista os D da spec.
const SKILL_LOOP = join(PLUGIN, 'skills/gabarito-loop/SKILL.md');
const SKILL_CONF = join(PLUGIN, 'skills/gabarito-conformidade/SKILL.md');

/**
 * Frases que mandam ou afirmam o agente rodando `/clear`: um verbo de execução (imperativo "rode/execute/digite", 1ª pessoa "vou/irei",
 * ou "você roda") nos 60 caracteres antes do `/clear`, sem o dono no meio e sem negação. "peça ao dono ... que digite `/clear`" é o texto certo.
 * `\b` é ASCII no JS: nada de fronteira depois de letra acentuada.
 */
const VERBO_CLEAR = /\b(?:rode|rodar|roda|rodo|executa|execute|executar|executo|digite|digitar|digita|digito|mande|mandar|manda|use|usar|faça|fazer|vou|irei|run)\b/i;
function atribuiClearAoAgente(texto) {
  const achados = [];
  for (const frase of texto.split(/(?<=[.!?])\s+|\n/)) {
    for (const m of frase.matchAll(/\/clear/g)) {
      const antes = frase.slice(Math.max(0, m.index - 60), m.index);
      if (VERBO_CLEAR.test(antes) && !/\bdono\b/i.test(antes) && !/nunca|não|jamais/i.test(antes)) achados.push(frase.trim());
    }
  }
  return achados;
}

test('clear-clausula-pega-imperativo-e-variacoes-e-poupa-o-pedido-ao-dono', () => {
  const t = readFileSync(SKILL_LOOP, 'utf8');
  const frase = 'Nunca diga que você roda `/clear`.';
  assert.ok(t.includes(frase), 'a negativa mudou: ajuste o teste');
  for (const ruim of ['Rode `/clear` você mesmo.', 'Vou rodar `/clear` quando passar de 50 %.', 'Execute `/clear` ao pousar.', 'O agente digita `/clear`.', 'Você roda `/clear` no pouso.', 'Mande `/clear` ao pousar.']) {
    assert.equal(atribuiClearAoAgente(t.replace(frase, ruim)).length, 1, `não pegou: ${ruim}`);
  }
  for (const bom of ['Peça ao dono, em 1 linha, que digite `/clear`.', 'Nunca diga que você roda `/clear`.', 'Nunca rode `/clear` você mesmo.']) {
    assert.deepEqual(atribuiClearAoAgente(bom), [], `falso positivo: ${bom}`);
  }
});

test('skill-loop-cita-aprender-pousar-registro-loop-dinamico', () => {
  const t = readFileSync(SKILL_LOOP, 'utf8');
  // (a) aprender ⇒ fechar cada pendência antes de despachar, com os dois comandos reais
  assert.match(t, /`aprender` \(`pendencias\[\{tipo,sessao,seq\}\]`\): antes de qualquer despacho, feche cada uma/);
  assert.match(t, /loop\.mjs" aprendizado <E\|A> M --regra <t> --entra-em instantaneo,brief:implementador --gatilho <sessao>:<seq>`/);
  assert.match(t, /loop\.mjs" aprendizado <E\|A> D --regra <t> --entra-em instantaneo,brief:implementador --gatilho <sessao>:<seq> --eventos <sessao>:<seq>`/);
  assert.match(t, /\(ou `--fonte <arquivo> --numero <n>` no lugar de `--eventos`; D sem evidência o CLI recusa\)/);
  assert.match(t, /loop\.mjs" aprendizado nada --gatilho <sessao>:<seq> --motivo <t>`/);
  // (b) aprendizados[] do item vão no brief
  assert.match(t, /`aprendizados\[\]` do item vão no brief/);
  // (c) pouso sem mod: pousar + pedir /clear ao dono em 1 linha; repassa o aviso
  assert.match(t, /rode `node "\$\{CLAUDE_PLUGIN_ROOT\}\/gates\/scripts\/loop\.mjs" pousar --sessao <id>`/);
  assert.match(t, /peça ao dono, em 1 linha, que digite `\/clear`/);
  assert.match(t, /repasse o `aviso` do JSON/);
  assert.match(t, /\(`task_em_voo` ⇒ ainda não\)/);
  // Cláusula negativa (P15): nenhuma frase atribui ao agente o `/clear` (imperativo, 1ª pessoa ou sujeito explícito); ver `atribuiClearAoAgente`.
  const frasesComClear = t.split(/(?<=[.!?])\s+|\n/).filter((f) => f.includes('/clear'));
  assert.deepEqual(atribuiClearAoAgente(t), [], 'frase que atribui o /clear ao agente');
  assert.ok(frasesComClear.length >= 2, 'o texto precisa citar o /clear (pedido ao dono e negação)');
  // (d) concluir ⇒ registro (gera e commita; FX6/D1), depois Entrega
  assert.match(t, /loop\.mjs" registro`, que gera e commita o registro \(não commite à mão\); então \*\*Entrega\*\* abaixo\./);
  // (c2) MINORs do review r1: pouso só na fronteira; /clear só se o pousar passou; commit só do registro, sem `git add` largo
  assert.match(t, /na fronteira \(contexto perto de 50 %, entre tasks\), rode/);
  assert.match(t, /\(`task_em_voo` ⇒ ainda não\); se passar, peça ao dono/);
  assert.doesNotMatch(t, /git add (-A|--all|\.)(\s|`|$)/m);
  // (e) loop dinâmico (S3)
  assert.match(t, /sob `\/loop` dinâmico \(sem intervalo\)/);
});

test('skill-conformidade-lista-d-com-spec: allowed-tools com node, comando real, D marcados AVISO, erro não vira "nenhum"', () => {
  const t = readFileSync(SKILL_CONF, 'utf8');
  assert.match(t, /^allowed-tools: .*Bash\(node:\*\)$/m);
  assert.match(t, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/gates\/scripts\/loop\.mjs" aprendizados --para spec`/);
  assert.match(t, /marque `AVISO` os que a spec não trata/);
  assert.match(t, /Liste cada D devolvido \(`regra`, `entrega`, `sessao:seq`\)/);
  assert.match(t, /M não entra nessa lista\./);
  assert.match(t, /Lista vazia é "nenhum D para spec"; erro/);
  assert.match(t, /erro ou `ok:false` é "aprendizados indisponíveis: <erro>", nunca "nenhum"/);
  // cláusula "não precisa de entrega" (REQ-APR-3): o comando real responde ok em repositório sem entrega
  const repo = mkdtempSync(join(tmpdir(), 'skill-conf-aprendizados-'));
  assert.equal(spawnSync('git', ['init', '-q', repo]).status, 0);
  const r = spawnSync(process.execPath, [join(PLUGIN, 'gates', 'scripts', 'loop.mjs'), 'aprendizados', '--para', 'spec'], { cwd: repo, encoding: 'utf8' });
  assert.equal(JSON.parse(r.stdout.trim().split('\n').pop()).ok, true, r.stdout + r.stderr);
  // comando real: roda em bash e zsh na costura (o extrator de FONTES cobre este arquivo)
  assert.ok(extrairComandosLoop().some((c) => c.rel === 'skills/gabarito-conformidade/SKILL.md' && /aprendizados --para spec/.test(c.cmd)), 'o comando não entrou na costura');
});

// ---- GM-13 FX8 (t6): o bullet `release_pr` da skill do loop manda o comando exato e proíbe `executar`.
test('skill-loop-release_pr-empurra-e-abre-o-pr', () => {
  const linha = readFileSync(SKILL_LOOP, 'utf8').split('\n').find((l) => l.startsWith('- `release_pr`'));
  assert.ok(linha, 'bullet release_pr ausente');
  assert.match(linha, /git push -u origin/);
  assert.match(linha, /gh pr create --base/);
  assert.match(linha, /não rode `executar`/i);
  assert.match(linha, /Nunca merge/);
  // GM-13 FX9 r3: o bullet INTEIRO por igualdade com o texto aprovado (4d24d8f); qualquer palavra trocada falha
  assert.equal(linha, "- `release_pr`: `git push -u origin HEAD` e `gh pr create --base <base> --head <branch> --title \"<entrega>: …\" --body-file <registro.md>`. Push de branch e PR não são deploy. Não rode `executar` nem `devolver`: só valem para `subir` e aqui dão `nao_subiu`. A base é a do `decidir`, mesmo que a doc do projeto diga outra; repasse o `aviso`, se vier. Negado pelo modo de permissão: dê ao dono os 2 comandos exatos e pare o turno. Se o `AGENTS.md` do projeto pedir ok para push/PR sem essa exceção (R1 da 1.1.0), não passe por cima: dê ao dono as 2 linhas completas, já preenchidas (`git push -u origin HEAD` e `gh pr create --base <base> --head <branch> --title \"…\" --body-file <registro.md>`), diga que `gabarito-instalar --atualizar` traz a R1 nova, e pare o turno. **Nunca merge.**", 'o bullet release_pr mudou');
});

// ---- GM-14 T22 (REQ-DIA-2, REQ-APR-5): a skill do loop, as regras de anotar, o comando e a nota da 2.1.0.
const COMANDO = join(PLUGIN, 'commands/gabarito.md');
const VIRADA = join(PLUGIN, 'docs/virada-2.1.md');
const AGENTS = join(PLUGIN, 'reference/AGENTS.md');
const LIMITE_LOCAL = 'Pane (lateral): a plataforma só a põe sozinha com ≥ 144 colunas (ao lado em tela cheia, acima da linha de digitar nas outras); abaixo disso o painel avisa e a Pane abre quando você pede /gabarito painel, em qualquer largura — sempre um só local';
const LIMITE_ONB = 'a plataforma só o põe sozinho com 144 colunas ou mais (ao lado da conversa em tela cheia, acima da linha de digitar nas outras); abaixo disso o painel avisa e ele abre quando você pede /gabarito painel, em qualquer largura';
const lerSkill = () => readFileSync(SKILL_LOOP, 'utf8');

/** Todo exemplo de `proxima`/`pousar` num texto: código inline `loop.mjs proxima|pousar …` ou `proxima|pousar --…`; devolve os que NÃO têm `--sessao`. */
export function exemplosSemSessao(texto) {
  const ruins = [];
  const eExemplo = (c) => /\bloop\.mjs"?\s+(proxima|pousar)(\s|$)/.test(c) || /^(proxima|pousar)\s+--/.test(c);
  let cerca = false;
  for (const linha of texto.split('\n')) {
    if (/^\s*```/.test(linha)) { cerca = !cerca; continue; }
    // linha de bloco cercado: a linha inteira é o exemplo; fora dele, só o código inline entre crases
    const trechos = cerca ? [linha] : [...linha.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
    for (const c of trechos) if (eExemplo(c) && !/--sessao\s/.test(c)) ruins.push(c);
  }
  return ruins;
}

test('skill-loop-proxima-e-pousar-com-sessao: todo exemplo de proxima e pousar (skill e comando) leva --sessao <id>', () => {
  for (const f of [SKILL_LOOP, COMANDO]) {
    const texto = readFileSync(f, 'utf8');
    assert.ok(/loop\.mjs"? (proxima|pousar)[^`\n]*--sessao <id>/.test(texto), `${f}: nenhum exemplo com --sessao`);
    assert.deepEqual(exemplosSemSessao(texto), [], `${f}: exemplo sem --sessao`);
  }
  // o detector pega o exemplo sem a flag (M-W10) e poupa o que a tem
  assert.deepEqual(exemplosSemSessao('rode `node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" proxima --vivos <n>`'), ['node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" proxima --vivos <n>']);
  assert.deepEqual(exemplosSemSessao('`node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" pousar`'), ['node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" pousar']);
  assert.deepEqual(exemplosSemSessao('só então `proxima --vivos <n>`.'), ['proxima --vivos <n>']);
  assert.deepEqual(exemplosSemSessao('`node "x/loop.mjs" proxima --vivos <n> --sessao <id>` e `pousar` nunca vem sozinho'), []);
  // bloco cercado (o exemplo canônico que o orquestrador copia): sem a flag falha, com ela passa
  const sem = 'node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/loop.mjs" proxima --vivos <n>   # n = vivos';
  assert.deepEqual(exemplosSemSessao('```bash\n' + sem + '\n```\n'), [sem]);
  assert.deepEqual(exemplosSemSessao('```bash\n' + sem.replace('<n> ', '<n> --sessao <id> ') + '\n```\n'), []);
  assert.equal(exemplosSemSessao(lerSkill().replace(' --sessao <id>   # n =', '   # n =')).length, 1);
  // a flag existe de verdade no CLI (nome conferido contra o cabeçalho de loop.mjs)
  const cli = readFileSync(join(PLUGIN, 'gates/scripts/loop.mjs'), 'utf8');
  assert.match(cli, /proxima: \{ pos: 0, flags: \['entrega', 'vivos', 'sessao'\] \}/);
  assert.match(cli, /pousar: \{ pos: null, flags: \['entrega', 'sessao'\] \}/);
});

test('skill-loop-cita-anotar-cinco-tipos: a seção "Anotar na hora" traz o comando e os cinco tipos; o comando grava de verdade', () => {
  const t = lerSkill();
  const secao = t.split('\n## ').find((s) => s.startsWith('Anotar na hora'));
  assert.ok(secao, 'seção "Anotar na hora" ausente');
  for (const tipo of ['ideia', 'desvio', 'assunto', 'duvida', 'pendencia']) assert.ok(secao.includes('`' + tipo + '`'), `tipo ${tipo} ausente`);
  assert.match(secao, /2 a 4 `--opcao <rótulo>`/);
  assert.match(secao, /suas\*\* palavras/);
  // GM-15 T35 (r.13): a skill ensina que pendência do orquestrador vai ao plano ou à retomada, e como fechar a antiga
  assert.match(secao, /`pendencia` o CLI recusa/);
  assert.match(secao, /plano \(plano\.json, brief da task\) ou à retomada/);
  assert.match(secao, /anotar --fechar <sessao>:<seq>/);
  assert.match(secao, /loop\.mjs" anotar --tipo <tipo> --texto <t> --sessao <id>`/);
  // o comando como escrito grava uma `nota` (bash e zsh, caminho com espaço)
  const cmd = secao.match(/node "\$\{CLAUDE_PLUGIN_ROOT\}\/gates\/scripts\/loop\.mjs" anotar[^`\n]*/)[0]
    .replace('<tipo>', 'ideia').replace('<t>', 'ligar para o banco').replace('<id>', 'sessao-1'); // GM-15 T35 (r.13): pendência do orquestrador recusa
  const base = mkdtempSync(join(tmpdir(), 'skills-anotar-'));
  const raiz = join(base, 'raiz com espaco');
  mkdirSync(raiz);
  symlinkSync(PLUGIN, join(raiz, 'plugin'));
  for (const sh of shellsDisponiveis()) {
    const repo = repoComEntrega();
    const r = spawnSync(sh, ['-c', cmd.replace('ligar para o banco', "'ligar para o banco'")], { cwd: repo, encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: join(raiz, 'plugin') } });
    const ctx = `${sh}: ${cmd}\nrc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`;
    assert.equal(JSON.parse(r.stdout.trim().split('\n').pop()).ok, true, ctx);
    const nota = diario.ler(join(repo, '.harness', 'entregas', 'GM-10')).filter((e) => e.tipo === 'nota').at(-1);
    assert.equal(nota?.dados?.tipo, 'ideia', ctx);
    assert.equal(nota?.dados?.texto, 'ligar para o banco', ctx);
  }
});

test('skill-loop-nao-cola-painel-texto: com o painel visível a skill proíbe colar painel.mjs texto; o comando só vale sem mod ou oculto', () => {
  const t = lerSkill();
  const i = t.indexOf('Com o painel visível (mod), **não cole** a saída de `painel.mjs texto` na conversa');
  const j = t.indexOf('Status ao dono: comece por `node');
  assert.ok(i >= 0, 'a proibição de colar sumiu');
  assert.ok(j > i, 'o comando do painel precisa vir DEPOIS da condição');
  assert.match(t.slice(i, j), /Sem mod ou com o painel oculto \(`\/gabarito painel ocultar`\):\n$/);
  assert.equal(t.split('painel.mjs" texto').length - 1, 1, 'um só comando do painel na skill');
});

test('skill-loop-description-com-task-e-modelo: despacho com a descricao do item e iniciar --modelo; spike entra como implementador', () => {
  const t = lerSkill();
  assert.match(t, /`iniciar <task> <papel> --modelo <modelo do item>`/);
  assert.match(t, /\(spike entra como `implementador`: `iniciar T0 spike` recusa\)/);
  assert.match(t, /`descricao` do item, sem mudar\. Ela é "<task> <resto>": o 1º token é o id da task\./);
  const cli = readFileSync(join(PLUGIN, 'gates/scripts/loop.mjs'), 'utf8');
  assert.ok(cli.includes('descricao: `${item.task} ${item.papel}`'), 'a descricao do item mudou');
  assert.match(cli, /iniciar: \{ pos: 2, flags: \['entrega', 'sessao', 'modelo', 'executor', 'motivo'\] \}/);
  assert.ok(t.includes('--executor orquestrador --motivo'), 'a skill não cita o desvio --executor orquestrador --motivo');
});

test('skill-loop-pouso-wakeup-autossuficiente: pousar, wakeup com prompt autossuficiente, pedir limpar e push, pendente não despacha', () => {
  const t = lerSkill();
  assert.match(t, /- `pousar` \(com `--sessao`, a partir de `x`, 50 %\): nesta ordem, `node "\$\{CLAUDE_PLUGIN_ROOT\}\/gates\/scripts\/loop\.mjs" pousar --sessao <id>`;/);
  assert.match(t, /arme o wakeup do `\/loop` com prompt autossuficiente, 1ª linha "retome a entrega <ID>" e o `instantaneo` do JSON \(é o prompt de retomada; não existe arquivo de retomada\)\./);
  assert.match(t, /Com o mod, ele limpa a conversa e avisa o dono por push \(o push é o aviso do mod, nunca `git push`\); sem mod, peça ao dono, em 1 linha, que digite `\/clear`\./);
  // o push não é ação do dono nem do orquestrador (FIEL-14 d); nenhum arquivo de retomada sem produtor
  assert.doesNotMatch(t, /dê o push|dar o push|arquivo de retomada>/);
  assert.match(t, /Pouso pendente \(`\/clear` ainda não dado\): \*\*não despache nada novo\*\*; `esperar` espera, `pousar` de novo repete o pedido\./);
  assert.match(t, /Sem onboarding nunca há pouso pendente\./);
  assert.match(t, /O `\/clear` do pouso é feito pelo mod; sem mod é do dono/);
  // a ordem prescrita: pousar antes do wakeup antes do pedido
  const l = t.split('\n').find((x) => x.startsWith('   - `pousar` (com'));
  assert.ok(l.indexOf('pousar --sessao') < l.indexOf('arme o wakeup') && l.indexOf('arme o wakeup') < l.indexOf('peça ao dono'));
  // a regra única do CLI, citada na skill, existe: `proxima` devolve esperar/pouso_pendente
  const nucleo = readFileSync(join(PLUGIN, 'gates/src/loop.ts'), 'utf8');
  assert.match(nucleo, /motivo: 'pouso_pendente'/);
});

test('skill-loop-despacha-so-por-proxima-com-aprendizados: só os itens de proxima; aprendizados colados no brief com o limite declarado', () => {
  const t = lerSkill();
  assert.match(t, /Despache \*\*só\*\* os itens de `proxima`, nada de cabeça\./);
  assert.match(t, /`aprendizados\[\]` do item vão no brief, como texto, colados por você \(limite declarado: nada confere que foram colados\)/);
  const cli = readFileSync(join(PLUGIN, 'gates/scripts/loop.mjs'), 'utf8');
  assert.match(cli, /aprendizados: paraDestino\(extra\.vigentes, `brief:\$\{item\.papel\}`\)/);
});

test('skill-loop-fatos-do-cli: --diff é caminho, --causa só duas, julgar da Sombra pede a opção em origin, liberar da Sombra com hash', () => {
  const t = lerSkill();
  assert.match(t, /`--diff` é o CAMINHO de um arquivo com o diff, não o texto/);
  assert.match(t, /`--causa` só aceita `regra_negocio` ou `tecnica`/);
  assert.match(t, /`emenda julgar <seq> aprovar\|rejeitar` com origem Sombra só vale com `sombra\.julga_emendas: true` em `origin\/HEAD`/);
  assert.match(t, /loop\.mjs" liberar <task> --origem sombra --hash <hash>`/);
  assert.match(t, /sombra\.mjs" perguntar --task <task> --libera-teto`/);
  assert.match(t, /`sombra_nao_liberou`/);
  const cli = readFileSync(join(PLUGIN, 'gates/scripts/loop.mjs'), 'utf8');
  assert.match(cli, /const CAUSAS = \['regra_negocio', 'tecnica'\];/);
  assert.match(cli, /emenda propor --req <REQ> \[--task <id>\] --diff <arquivo>/);
  assert.match(cli, /sombra_nao_liberou/);
});

test('agents-regra-anotar-palavras-proprias: a regra de REQ-DIA-2 no AGENTS.md de referência', () => {
  const t = readFileSync(AGENTS, 'utf8');
  const linha = t.split('\n').find((l) => l.startsWith('**Anota na hora (REQ-DIA-2).**'));
  assert.ok(linha, 'regra ausente');
  assert.match(linha, /loop\.mjs anotar --tipo <ideia\|desvio\|assunto\|duvida\|pendencia> --texto <t>/);
  assert.match(linha, /em 1 linha, com palavras próprias \(nunca a fala do dono copiada\)/);
  for (const frag of ['ideia nova', 'desvio', 'mudança de assunto', 'dúvida que só o dono resolve (2 a 4 `--opcao`)', 'tarefa do dono fora daqui (`pendencia`)']) assert.ok(linha.includes(frag), frag);
  assert.equal(t.split('**Anota na hora (REQ-DIA-2).**').length - 1, 1, 'uma só regra');
});

test('commands-cita-ocultar-e-chat: o comando declara painel ocultar|mostrar, chat cru|natural e os limites sem medição', () => {
  const t = readFileSync(COMANDO, 'utf8');
  assert.match(t, /`painel ocultar\|mostrar` \(menos o PAROU e a pergunta aberta, que ficam\)/);
  assert.match(t, /`chat cru\|natural`/);
  assert.match(t, /S1c NÃO MEDIDO: `hasSurvey` não teve teste real/);
  assert.match(t, /S2b: o `ToolUse` solo chegou como grupo de 1 em 6\/6 medições, mas só a leitura \(`Read`\) foi medida/);
  assert.match(t, /N11: o contexto do orquestrador no mod depende de `usage\.context\.percent` \(spike S10 a medir\)/);
  assert.match(t, /S13 \(fim de subagente\), medido em 6\/6: .*O AGORA só encerra um agente pela lista, nunca pelo `SubagentStop` sozinho\./);
  assert.match(t, /S14 \(segundo plano\), fim de tarefa de subagente: a notificação do fim não chegou ao mod em 0\/3; o fim só se vê pelo sumiço em `background_tasks`/);
  assert.match(t, /o segundo plano já aparece no painel\): `\.superpowers\/sdd\/2026-11-11-proxima\/t0b-relatorio\.md`/);
  assert.doesNotMatch(t, /sem a confirmação|e o segundo plano não aparece|sem medição que os feche/);
  assert.match(t, /`onboarding\.mjs herdar` é o passo de adoção do `--atualizar`/);
  assert.match(t, /`--gravar` grava só `fluxo\.planosLegados` e `fluxo\.status\.terminais`; nenhum card é escrito/);
  assert.match(t, /A herança das regras da 1\.x nunca foi feita e está no backlog/);
  assert.doesNotMatch(t, /chega na 2\.2|regras herdadas da 1\.x/);
  // o que o comando cita do mod existe no mod
  const mod = readFileSync(join(PLUGIN, 'mod/chat.mjs'), 'utf8');
  assert.match(mod, /uso: \/gabarito chat cru\|natural/);
});

test('commands-cita-painel-local: /gabarito painel lateral|acima com o limite da plataforma', () => {
  const t = readFileSync(COMANDO, 'utf8');
  assert.match(t, /`painel lateral\|acima` \(onde o painel fica\)/);
  assert.ok(t.includes(LIMITE_LOCAL), 'limite literal ausente do comando');
  assert.match(t, /O mod nunca troca de local sozinho pela largura; o padrão é `lateral`\./);
});

test('virada-diz-o-limite-do-local: a nota da 2.1.0 traz a frase da escolha e a do limite, as duas completas (144 colunas, acima da linha de digitar, qualquer largura a pedido)', () => {
  const t = readFileSync(VIRADA, 'utf8');
  assert.ok(t.includes(LIMITE_ONB), 'frase da escolha do local incompleta na nota da virada');
  assert.ok(t.includes(LIMITE_LOCAL), 'frase do limite incompleta na nota da virada');
});

test('texto-nao-promete-o-que-saiu: FIEL-16 e FIEL-17 (T40/T41, fora da 2.1.0) não aparecem como entregues; sem emoji', () => {
  for (const f of [SKILL_LOOP, COMANDO, VIRADA, AGENTS]) {
    const t = readFileSync(f, 'utf8');
    assert.doesNotMatch(t, /FIEL-1[67]|autonomia sem trava|diario_de_versao_nova/, `${f}: promete o que não entrou`);
    assert.doesNotMatch(t, /[\p{Extended_Pictographic}\uFE0F]/u, `${f}: emoji`);
  }
});

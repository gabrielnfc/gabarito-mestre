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
        .replace(/<n>/g, '1').replace(/<task>/g, 'T1').replace(/<[^<>]*>/g, 'x').trim();
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
  assert.match(t, /rode `node "\$\{CLAUDE_PLUGIN_ROOT\}\/gates\/scripts\/loop\.mjs" pousar`/);
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

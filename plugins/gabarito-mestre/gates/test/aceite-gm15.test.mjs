/**
 * GM-15 T27 (REQ-ENT-1, REQ-ENT-2, REQ-AUT-1): o ACEITE FINAL da spec ("Aceite final", emenda 26 / D-G20), pelos CLIs reais num repo temporário, nunca pelo repo real.
 *
 * REPLAY da GM-14 (fixtures/gm15-aceite/: `eventos.jsonl` = RECORTE do diário real da GM-14 (os eventos que o painel lê: task, nota, pendência, consulta à Sombra, parar,
 * fato medido...), regravados por sessão; o revisor mediu o MESMO resultado com os 21 events.*.jsonl inteiros; `plano.json` real; `events.sessao-1.jsonl` real do backup, com o
 * #8 "aberto" e a release v2.0.0 já velhos; `gh` com os PRs #7, #8, #17 e #22 com os VALORES REAIS do GitHub). Rodado COM e SEM o `events.sessao-1.jsonl`:
 *   (a.1) `aceite-replay-gm14-prs-reais-nao-encerra`: com os PRs reais a única publicação é a PRÉ-VERSÃO (#22 alpha.1) e ela NÃO encerra (emenda 20, D-G14) ⇒ nenhum
 *     entrega.encerrada, o painel não diz "entregue", nem antes nem depois de uma `dono.resposta` posterior; nenhum item da GM-14 trava o DEPENDE nem o Stop (o que aparece é só
 *     informativo e está declarado abaixo, com o motivo). Emenda 27 (D-G21): `aceite-replay-gm14-prs-reais-painel-atual-sem-gm14` = o painel da ENTREGA ATUAL (branch da GM-15)
 *     sem nenhum item da GM-14 (DEPENDE, pergunta, ATENÇÃO) e Stop mudo; LIMITE DECLARADO `aceite-replay-gm14-limite-painel-da-gm14`: o painel `--entrega GM-14` mostra o T8 no teto e a
 *     pergunta antiga enquanto ela não encerrar (asserido como medido; resolve na 2.1.1 com o encerramento pela versão final, backlog D-G20).
 *   (a.2) `aceite-versao-final-sintetica-encerra`: o MECANISMO da versão final, com UM PR de versão final SINTÉTICO de fixture (9001, não existe no GitHub) ⇒ c1 1 linha
 *     "GM-14 entregue" · c2 0 item da GM-14 no DEPENDE (só a oferta da próxima, com o botão "seguir") · c3 Stop silencioso · c4 a próxima entrega oferecida · c5 tudo isso de novo
 *     depois de uma `dono.resposta` posterior ao merge. (Regra para a última publicação pré-versão encerrar com a versão final: backlog 2.1.1, D-G20.)
 * ENTREGA SINTÉTICA (c7): 1 task `no_teto` + 3 independentes ⇒ `proxima` nunca para enquanto há independente (conferido em TODO `proxima`, liberação da Sombra ligada e
 * desligada), a Sombra adia a task (`adiar --origem sombra --fonte`) ⇒ `concluir`, sem `loop.parar`, com a adiada FORA do total do PRONTO (c8).
 * O teste só vê a cópia: o checkout (status, HEAD, branch, worktrees) é conferido antes e depois (c9).
 *
 * MUTAÇÕES (nomeadas no plano): M27a `entregaPublicada` na regra antiga (a pré-versão encerra) ⇒ (a.1) cai · M27a' o PR final sintético não encerra ⇒ (a.2) cai ·
 * M27b `prs()` sem REMEDIR o #8 (o `aberto` do diário fica) ⇒ cai a asserção c10 (['aberto','mergeado']) · `prs()` sem o DESCARTE por head é EQUIVALENTE neste aceite (declarado): com os PRs reais
 *   o `ultimo` é o #22 (maior número, mergeado), então o #8 de outra entrega nunca é o `ultimo` nem o `aberto` visível; quem mata essa mutação é trilha.test.ts `titulo-sem-id-no-head-encerra` · M27c `adiada` no total ⇒ c8 · M27d `proxima` para com independente restante ⇒ c7.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { raizSegura, raizesDeCheckout } from './_raiz-segura.mjs';
import { append, ler } from '../dist/diario.js';
import { fecharPendenciasNoDiario } from './_adaptador-helpers.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(AQUI, '..', 'scripts');
const PAINEL = join(SCRIPTS, 'painel.mjs');
const STOP = join(SCRIPTS, 'stop-loop.mjs');
const LOOP = join(SCRIPTS, 'loop.mjs');
const FIX = join(AQUI, 'fixtures', 'gm15-aceite');
const SID = 'sessao-1';
const TETO = 90_000; // nenhum processo trava o teste

// Fixture com git real: HOME vazio, sem config global, e `user.useConfigOnly` para o commit só passar com o `-c` explícito.
const HOME_VAZIO = realpathSync(mkdtempSync(join(tmpdir(), 'aceite-home ')));
const GIT_ENV = { PATH: process.env.PATH, HOME: HOME_VAZIO, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_OPTIONAL_LOCKS: '0' };
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'user.useConfigOnly=true', ...a], { cwd, encoding: 'utf8', env: GIT_ENV, timeout: TETO }).trim();

/** Env sem `GABARITO_*` nem `CLAUDE_PROJECT_DIR` herdados; `gh` = o de fixture; HOME vazio. */
function env(extra = {}) {
  const e = { ...process.env, ...GIT_ENV, PATH: `${FIX}:${process.env.PATH}` };
  for (const k of Object.keys(e)) if (k.startsWith('GABARITO_') || k === 'CLAUDE_PROJECT_DIR') delete e[k];
  return { ...e, ...extra };
}
const dirDe = (d, id) => join(d, '.harness', 'entregas', id);
function w(d, id, sessao, tipo, dados, ts, agente = 'orquestrador') {
  const r = append(dirDe(d, id), sessao, { ts, autor: 't@t', sessao, agente, tipo, dados });
  assert.ok(r.ok && r.gravado === 'evento', `preparo: ${tipo} ${JSON.stringify(r)}`);
}

// ── o checkout não muda (c9) ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function fotoDoCheckout(raiz = raizesDeCheckout()[0]) {
  const g = (...a) => execFileSync('git', ['-C', raiz, ...a], { encoding: 'utf8', env: GIT_ENV, timeout: TETO }).trim();
  const branch = g('rev-parse', '--abbrev-ref', 'HEAD'); // "HEAD" quando destacado (checkout da CI): então não há refs/heads/<branch> a conferir
  const meu = g('worktree', 'list', '--porcelain').split('\n\n').filter((b) => b.split('\n')[0] === `worktree ${raiz}`);
  return { raiz, status: g('status', '--porcelain=v1', '--untracked-files=all'), head: g('rev-parse', 'HEAD'), ref: branch === 'HEAD' ? null : g('rev-parse', `refs/heads/${branch}`), meu };
}

// (T38) a CI faz checkout com HEAD destacado: a foto do checkout não pode exigir refs/heads/<branch>
test('aceite-foto-do-checkout-funciona-com-HEAD-destacado: branch nomeada e HEAD destacado dão foto, e a foto é estável', () => {
  const d = join(raizSegura(realpathSync(mkdtempSync(join(tmpdir(), 'aceite foto ')))), 'r');
  mkdirSync(d, { recursive: true });
  git(d, 'init', '-q', '-b', 'main');
  writeFileSync(join(d, 'a'), 'a\n');
  git(d, 'add', 'a');
  git(d, 'commit', '-q', '-m', 'a');
  const nomeada = fotoDoCheckout(d);
  assert.ok(nomeada.ref, 'branch nomeada: ref preenchida');
  git(d, 'checkout', '-q', '--detach');
  const destacado = fotoDoCheckout(d);
  assert.equal(destacado.ref, null, 'destacado: sem ref de branch');
  assert.equal(destacado.head, nomeada.head);
  assert.deepEqual(fotoDoCheckout(d), destacado, 'destacado: a foto não muda sozinha');
});

// ── o replay da GM-14 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const SPEC_PROXIMA = 'GM-15 Fluidez do loop'; // "<PBI> <título da spec>"
/** Repo descartável na branch da GM-14, com onboarding, a spec da próxima entrega (GM-15) e o diário real da GM-14 (com ou sem o `events.sessao-1.jsonl`). */
function replayGm14({ comSessao1, branch = 'enabler/GM-14-clareza' }) {
  const d = join(raizSegura(realpathSync(mkdtempSync(join(tmpdir(), 'aceite gm14 ')))), 'r');
  mkdirSync(d, { recursive: true });
  git(d, 'init', '-q', '-b', 'main');
  writeFileSync(join(d, 'harness.config.json'), '{}\n');
  git(d, 'add', 'harness.config.json');
  git(d, 'commit', '-q', '-m', 'onboarding');
  git(d, 'checkout', '-q', '-b', branch);
  mkdirSync(join(d, 'docs', 'superpowers', 'specs'), { recursive: true });
  writeFileSync(join(d, 'docs', 'superpowers', 'specs', '2026-11-16-gm15.md'), `# Fluidez do loop\n\nPBI: GM-15\n\n## Seção\n`);
  mkdirSync(dirDe(d, 'GM-14'), { recursive: true });
  copyFileSync(join(FIX, 'plano.json'), join(dirDe(d, 'GM-14'), 'plano.json'));
  if (comSessao1) copyFileSync(join(FIX, 'events.sessao-1.jsonl'), join(dirDe(d, 'GM-14'), 'events.sessao-1.jsonl'));
  const reais = readFileSync(join(FIX, 'eventos.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(reais.length > 900, 'preparo: o diário real da GM-14 (fixture) está inteiro');
  for (const e of reais) w(d, 'GM-14', e.sessao, e.tipo, e.dados, e.ts, e.agente);
  return d;
}

function cli(script, d, args, { sessao = SID, extra = {}, entrada } = {}) {
  return spawnSync(process.execPath, [script, ...args], { cwd: d, input: entrada ?? JSON.stringify({ session_id: sessao, agentes: [] }), encoding: 'utf8', env: env(extra), timeout: TETO });
}
const painel = (d, args, opts) => cli(PAINEL, d, [...args, '--agentes'], opts);
function medir(d, extra = {}) {
  const r = painel(d, ['medir'], { extra });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout);
}
function estado(d) {
  const r = painel(d, ['estado']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, true, r.stdout);
  return j.estado;
}
function texto(d, largura = 120) {
  const r = painel(d, ['texto', '--largura', String(largura)]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout.replace(/\n$/, '').split('\n');
}
function stop(d) {
  return spawnSync(process.execPath, [STOP], { cwd: d, input: JSON.stringify({ session_id: SID, cwd: d, background_tasks: [] }), encoding: 'utf8', env: env({ CLAUDE_PROJECT_DIR: d }), timeout: TETO });
}
const SEGUIR = { rotulo: 'seguir', comando: '/gabarito-mestre:gabarito-loop' };
const MERGE_FINAL = '2026-11-16T12:00:00Z'; // o mergedAt do PR final SINTÉTICO (9001) no `gh` de fixture: o `dono.resposta` "posterior ao merge" é relativo a ele, nunca ao relógio

/** O que o aceite exige, uma asserção por cláusula, com a mensagem dizendo qual. */
function confere(d, quando) {
  const e = estado(d);
  // c1: a linha única
  assert.deepEqual(e.entregue, { id: 'GM-14', versao: null }, `${quando} c1: GM-14 entregue (sem versão amarrada ao PR)`);
  assert.equal(e.umaLinha, null, `${quando} c1: a linha é a de entregue`);
  const ls = texto(d);
  assert.equal(ls.length, 1, `${quando} c1: 1 linha\n${ls.join('\n')}`);
  assert.match(ls[0], /^(◆ )?GABARITO · GM-14 entregue · próxima: /, `${quando} c1`);
  // c2: 0 item da GM-14 no DEPENDE (o único é a oferta da próxima, spec (d)(i)), nada de PRONTO, PARAR, pergunta nem ATENÇÃO da entrega
  assert.deepEqual(e.depende, [{ nivel: 'dono', motivo: `próxima entrega: ${SPEC_PROXIMA}`, acoes: [SEGUIR] }], `${quando} c2: DEPENDE só com a oferta da próxima`);
  assert.equal(e.pronto, null, `${quando} c2: sem PRONTO`);
  assert.equal(e.parar, null, `${quando} c2: sem PAROU`);
  assert.equal(e.pergunta, null, `${quando} c2: sem pergunta`);
  assert.deepEqual(e.atencao, [], `${quando} c2: sem ATENÇÃO`);
  // c4: a próxima entrega oferecida, com o botão
  assert.deepEqual(e.proxima, { tipo: 'spec', texto: SPEC_PROXIMA, acoes: [SEGUIR] }, `${quando} c4: a próxima oferecida`);
  assert.equal(ls[0].endsWith(`próxima: ${SPEC_PROXIMA}`), true, `${quando} c4: a linha diz a próxima\n${ls[0]}`);
  // c3: Stop silencioso
  const s = stop(d);
  assert.equal(s.status, 0, `${quando} c3: ${s.stderr}`);
  assert.equal(s.stdout, '', `${quando} c3: Stop silencioso`);
  assert.equal(s.stderr, '', `${quando} c3: Stop sem stderr`);
}

const FINAL = { GH_FINAL_SINTETICO: '1' };
const encerradas = (d) => ler(dirDe(d, 'GM-14')).filter((x) => x.tipo === 'entrega.encerrada');
const fato8 = (d) => ler(dirDe(d, 'GM-14')).filter((x) => x.tipo === 'fato.medido' && x.dados?.chave === 'pr' && x.dados?.valor?.numero === 8).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

for (const comSessao1 of [true, false]) {
  const nome = comSessao1 ? 'COM events.sessao-1.jsonl' : 'SEM events.sessao-1.jsonl';

  // (a.2) o MECANISMO da versão final: PR final SINTÉTICO de fixture (9001), declarado como tal no nome, no comentário e no `gh`
  test(`aceite-versao-final-sintetica-encerra: ${nome}, PR de versão final SINTÉTICO (fixture 9001) ⇒ 1 linha "GM-14 entregue", 0 item no DEPENDE, Stop mudo, próxima oferecida; o mesmo depois de dono.resposta posterior ao merge`, () => {
    const antes = fotoDoCheckout();
    const d = replayGm14({ comSessao1 });

    // controle: antes do `medir` a GM-14 está em aberto (o teste não passa por vacuidade)
    const aberta = estado(d);
    assert.equal(aberta.entregue ?? null, null, 'controle: antes do medir a GM-14 não está entregue');
    assert.ok(texto(d).length > 1 || aberta.umaLinha !== null || aberta.depende.length > 0 || aberta.pronto !== null, 'controle: a entrega aberta desenha mais que a linha de entregue');

    // o `medir` pelo CLI real, com o `gh` de fixture: só o PR final SINTÉTICO encerra; o #22 (alpha.1) e o #8 (mergeado de outra entrega) não
    const m = medir(d, FINAL);
    assert.equal(m.ok, true, JSON.stringify(m));
    assert.deepEqual(encerradas(d).map((x) => x.dados), [{ entrega: 'GM-14', pr: 9001, via: 'titulo', mergeado_em: MERGE_FINAL }], 'c6: encerra pelo PR final sintético (9001), nunca pelo #22 (pré-versão) nem pelo #8');
    // c10 (M27b): o #8 que o `events.sessao-1.jsonl` dá como `aberto` é REMEDIDO por número e vira mergeado (de outra entrega); sem o arquivo, nenhum fato do #8 existe
    const f8 = fato8(d);
    if (comSessao1) {
      assert.deepEqual(f8.map((x) => x.dados.valor.estado), ['aberto', 'mergeado'], 'c10: o #8 aberto do diário foi remedido e está mergeado');
      assert.equal(f8.at(-1).dados.valor.branch, 'enabler/GM-9-fundacao-2.0', 'c10: a remedição traz o head real de outra entrega');
    } else assert.deepEqual(f8, [], 'c10: sem o arquivo da sessão 1 não há #8 no diário');
    confere(d, 'depois do merge');

    // c5: uma `dono.resposta` POSTERIOR ao merge (relativa ao mergedAt) não reabre nada nem traz item de volta; repetida nas 2 formas que o dono usa
    let ts = Date.parse(MERGE_FINAL);
    for (const rotulo of ['visto', 'feito']) {
      ts += 3_600_000;
      w(d, 'GM-14', '01db6bdc-aaaa-4bbb-8ccc-0123456789ab', 'dono.resposta', { pergunta: 'loop:1', opcao: 1, rotulo }, new Date(ts).toISOString(), 'dono');
      confere(d, `depois da dono.resposta "${rotulo}"`);
    }
    assert.equal(ler(dirDe(d, 'GM-14')).filter((x) => x.tipo === 'loop.parar' && Date.parse(x.ts) > Date.parse(MERGE_FINAL)).length, 0, 'nada para o loop depois do merge');

    // c9: o checkout real não mudou (a cópia é a única coisa que o teste escreveu)
    assert.deepEqual(fotoDoCheckout(), antes, 'c9: o checkout real ficou intocado');
  });

  // (a.1) o replay REAL: valores reais dos PRs, só a pré-versão ⇒ não encerra
  test(`aceite-replay-gm14-prs-reais-nao-encerra: ${nome}, PRs #7 #8 #17 #22 com os valores reais ⇒ nenhum entrega.encerrada, painel não diz "entregue", o #8 fora do DEPENDE, Stop mudo`, () => {
    const antes = fotoDoCheckout();
    const d = replayGm14({ comSessao1 });
    const m = medir(d);
    assert.equal(m.ok, true, JSON.stringify(m));
    // M27a: a pré-versão (#22 alpha.1, head chore/GM-14-virada-2-1) voltando a encerrar derruba aqui
    assert.deepEqual(encerradas(d), [], 'c6: a pré-versão (#22) não encerra com os PRs reais');
    // M27b: o #8 do diário (aberto) é remedido por número (mergeado, head de OUTRA entrega, GM-9) e não vira item da GM-14 aberta (o descarte por head em prs() é equivalente aqui: ver o docstring)
    const f8 = fato8(d);
    if (comSessao1) assert.deepEqual(f8.map((x) => x.dados.valor.estado), ['aberto', 'mergeado'], 'c10: o #8 aberto do diário foi remedido e está mergeado');
    else assert.deepEqual(f8, [], 'c10: sem o arquivo da sessão 1 não há #8 no diário');

    const checa = (quando) => {
      const e = estado(d);
      assert.equal(e.entregue ?? null, null, `${quando}: a GM-14 não está entregue só com a pré-versão`);
      assert.notEqual(texto(d)[0].includes('entregue'), true, `${quando}: o painel não diz "entregue"`);
      // o "#8" (de outra entrega, head GM-9) não é item da GM-14 (M27b); os itens que a GM-14 aberta AINDA mostra estão no teste `...-depende-sem-item-da-gm14` (todo)
      assert.ok(!e.depende.some((i) => /#8\b/.test(i.motivo)), `${quando}: o #8 sai do DEPENDE ${JSON.stringify(e.depende)}`);
      const s = stop(d);
      assert.equal(s.status, 0, `${quando} Stop: ${s.stderr}`);
      assert.equal(s.stdout, '', `${quando}: Stop silencioso (a GM-14 não trava o Stop)`);
      assert.equal(s.stderr, '', `${quando}: Stop sem stderr`);
    };
    checa('depois do medir');

    // c5: uma `dono.resposta` posterior ao último merge real não encerra nem traz bloqueio
    const posterior = Date.parse('2026-11-15T13:50:59Z') + 3_600_000;
    w(d, 'GM-14', '01db6bdc-aaaa-4bbb-8ccc-0123456789ab', 'dono.resposta', { pergunta: 'loop:1', opcao: 1, rotulo: 'visto' }, new Date(posterior).toISOString(), 'dono');
    assert.deepEqual(encerradas(d), [], 'c5: a dono.resposta não encerra');
    checa('depois da dono.resposta');
    assert.deepEqual(encerradas(d), [], 'c5: nenhum entrega.encerrada depois da medição repetida');

    assert.deepEqual(fotoDoCheckout(), antes, 'c9: o checkout real ficou intocado');
  });
}

// (a.1, emenda 27 / D-G21) o painel da ENTREGA ATUAL (a próxima, GM-15, como o dono o vê pela branch, sem `--entrega GM-14`) não traz NADA da GM-14 (DEPENDE, pergunta, ATENÇÃO)
// e o Stop fica mudo, com os PRs reais (a GM-14 segue sem encerrar). Mutação: item da GM-14 vazando para esse painel ⇒ cai.
const BRANCH_ATUAL = 'enabler/GM-15-fluidez';
const DA_GM14 = /GM-14|\bT8\b|\bT41\b|conversa mudou de assunto|consultas? à Sombra|decis(ão|ões) da Sombra/;
for (const comSessao1 of [true, false]) {
  test(`aceite-replay-gm14-prs-reais-painel-atual-sem-gm14: ${comSessao1 ? 'COM' : 'SEM'} events.sessao-1.jsonl, PRs reais, branch da GM-15 ⇒ Stop mudo e nenhum item da GM-14 no DEPENDE, na pergunta nem no ATENÇÃO`, () => {
    const d = replayGm14({ comSessao1, branch: BRANCH_ATUAL });
    const m = medir(d);
    assert.equal(m.ok, true, JSON.stringify(m));
    assert.deepEqual(encerradas(d), [], 'a GM-14 não encerra com os PRs reais');
    const e = estado(d);
    assert.deepEqual(e.depende.filter((i) => DA_GM14.test(`${i.motivo} ${JSON.stringify(i.acoes)}`)), [], `DEPENDE da entrega atual sem item da GM-14 ${JSON.stringify(e.depende)}`);
    assert.equal(e.pergunta === null || !DA_GM14.test(JSON.stringify(e.pergunta)), true, `pergunta da entrega atual sem a da GM-14 ${JSON.stringify(e.pergunta)}`);
    assert.deepEqual(e.atencao.filter((x) => DA_GM14.test(x)), [], `ATENÇÃO da entrega atual sem a da GM-14 ${JSON.stringify(e.atencao)}`);
    const t = texto(d).join('\n');
    assert.doesNotMatch(t, /conversa mudou de assunto|decidir a T8|consultas à Sombra sem decisão/, 'o painel desenhado da entrega atual sem texto da GM-14');
    const s = stop(d);
    assert.equal(s.status, 0, s.stderr);
    assert.equal(s.stdout, '', 'Stop silencioso');
    assert.equal(s.stderr, '', 'Stop sem stderr');
  });
}

// LIMITE DECLARADO (D-G21, backlog 2.1.1 / D-G20): o painel da própria GM-14 (`--entrega GM-14`) mostra itens antigos do dono enquanto ela não encerrar. Estado MEDIDO, asserido
// como é (não `todo`): o T8 no teto com o botão "liberar mais uma rodada" e a pergunta de gatilho antiga. Resolve-se na 2.1.1 com o encerramento pela versão final.
test('aceite-replay-gm14-limite-painel-da-gm14: `--entrega GM-14` com os PRs reais mostra o T8 no teto e a pergunta antiga (limite declarado, D-G21)', () => {
  const d = replayGm14({ comSessao1: false });
  assert.equal(medir(d).ok, true);
  const r = cli(PAINEL, d, ['estado', '--entrega', 'GM-14', '--agentes']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const e = JSON.parse(r.stdout).estado;
  assert.deepEqual(e.depende, [{ nivel: 'dono', motivo: 'decidir a T8: chegou ao limite de revisões', acoes: [{ rotulo: 'liberar mais uma rodada', comando: '/gabarito-mestre:liberar T8' }] }], 'limite: o T8 no teto no DEPENDE da GM-14');
  assert.match(e.pergunta?.texto ?? '', /conversa mudou de assunto/, 'limite: a pergunta antiga aberta');
  assert.equal(e.entregue ?? null, null, 'limite: a GM-14 não está entregue');
});

// ── a entrega sintética (c7, c8) ────────────────────────────────────────────────────────────────────────────────────────────────────────
const V = 'a'.repeat(40);
const LOTE_CAP = { GABARITO_CAP_HOSTNAME: 'h', GABARITO_CAP_CORES: '8', GABARITO_CAP_LOAD1: '0.5', GABARITO_CAP_MEM_MB: '64000', GABARITO_CAP_DISCO_GB: '500', GABARITO_CAP_PESADOS: '0' };

/** `refs/remotes/origin/HEAD` com `harness.config.json` = `cfg`, por plumbing (a árvore local não muda), como o loop lê a Sombra do projeto. */
function comOrigin(d, cfg) {
  const feito = (args, input) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-C', d, ...args], { encoding: 'utf8', input, env: GIT_ENV, timeout: TETO }).trim();
  const blob = feito(['hash-object', '-w', '--stdin'], JSON.stringify(cfg));
  const arvore = feito(['mktree'], `100644 blob ${blob}\tharness.config.json\n`);
  const commit = feito(['commit-tree', arvore, '-m', 'origin']);
  feito(['update-ref', 'refs/remotes/origin/main', commit]);
  feito(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
}

/** Repo temporário com plano de 4 tasks independentes (T1..T4); T1 no teto (2 REPROVADO), T2..T4 pendentes. */
function sintetica({ liberaTeto }) {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'aceite sintetica ')));
  raizSegura(d);
  git(d, 'init', '-q', '-b', 'enabler/GM-90-x');
  const cfg = { gates: { suites: ["echo '# pass 1'"] }, loop: { slots: 2 } };
  writeFileSync(join(d, 'harness.config.json'), JSON.stringify(cfg));
  writeFileSync(join(d, '.gitignore'), '.harness/entregas/\n.harness/worktrees/\n.harness/capacidade.json\n');
  mkdirSync(join(d, 'docs'), { recursive: true });
  writeFileSync(join(d, 'docs', 'spec.md'), '# Spec\n\n**REQ-A-1** regra A.\n\n**REQ-B-1** regra B.\n');
  git(d, 'add', '-A');
  git(d, 'commit', '-q', '-m', 'base');
  comOrigin(d, { ...cfg, sombra: { libera_teto: liberaTeto, julga_emendas: true } });
  const E = dirDe(d, 'GM-90');
  mkdirSync(E, { recursive: true });
  const plano = { entrega: 'GM-90', tasks: [1, 2, 3, 4].map((i) => ({ id: `T${i}`, deps: [], arquivos: [`src/t${i}.txt`] })) };
  writeFileSync(join(E, 'plano.json'), JSON.stringify(plano));
  writeFileSync(join(d, '.harness', 'capacidade.json'), JSON.stringify({ hostname: 'h', slots_max: 2, rss_pico_mb: 500, tmpdir_mb: 100, cpu_total: 100, load_medido: 1 }));
  let s = 0;
  const sem = (tipo, dados) => { s += 1; w(d, 'GM-90', 'loop', tipo, dados, new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString()); };
  sem('task.iniciada', { task: 'T1', papel: 'implementador' });
  sem('task.concluida', { task: 'T1', sha: V });
  sem('review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 1, blocker: 0, major: 1 });
  sem('task.iniciada', { task: 'T1', papel: 'correcao' });
  sem('task.concluida', { task: 'T1', sha: 'b'.repeat(40) });
  sem('review.veredito', { task: 'T1', veredito: 'REPROVADO', rodada: 2, blocker: 0, major: 1 });
  const fechar = () => fecharPendenciasNoDiario(E, plano);
  fechar();
  const integrar = (t) => {
    sem('task.iniciada', { task: t, papel: 'implementador' });
    sem('task.concluida', { task: t, sha: V });
    sem('review.veredito', { task: t, veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 });
    sem('task.integrada', { task: t });
    fechar();
  };
  const loop = (args) => {
    const r = spawnSync(process.execPath, [LOOP, ...args], { cwd: d, encoding: 'utf8', env: env(LOTE_CAP), timeout: TETO });
    let j = null;
    try { j = JSON.parse(r.stdout.trim()); } catch { /* fica null */ }
    return { rc: r.status, j, out: r.stdout + r.stderr };
  };
  return { d, E, loop, integrar };
}

for (const liberaTeto of [true, false]) {
  test(`aceite-sintetica-teto-adiada-concluir (sombra.libera_teto ${liberaTeto ? 'ligado' : 'desligado'}): 1 task no_teto + 3 independentes ⇒ concluir com a task adiada e sem parar`, () => {
    const antes = fotoDoCheckout();
    const { d, E, loop, integrar } = sintetica({ liberaTeto });

    // c7: em TODO `proxima` até o concluir, `parar` nunca aparece enquanto há task independente (M27d: parar com 1 ou 2 restantes)
    const semParar = (p, restantes, quando) => {
      assert.equal(p.rc, 0, p.out);
      if (restantes.length > 0) {
        assert.equal(p.j.acao.tipo, 'despachar', `c7 ${quando}: com ${restantes} independente(s) a ação é despachar, nunca parar: ${JSON.stringify(p.j.acao)}`);
        const t = p.j.acao.itens.map((i) => i.task).sort();
        assert.equal(t.length, Math.min(2, restantes.length), `c7 ${quando}: despacha até os 2 slots (loop.slots=2) ${t}`);
        assert.ok(t.every((x) => restantes.includes(x)), `c7 ${quando}: só independentes que faltam, a T1 no teto fora ${t}`);
      }
    };
    // 1. a task no teto NÃO para o loop: as 3 independentes saem primeiro, e a no_teto só vai ao lote do dono quando não há mais nenhuma
    const restantes = ['T2', 'T3', 'T4'];
    semParar(loop(['proxima', '--vivos', '0']), restantes, 'com 3');
    // 2. cada uma integra e o `proxima` seguinte ainda não para (com 2 e com 1 restantes); só a T1 sobra no fim
    for (const t of ['T2', 'T3']) {
      integrar(t);
      restantes.splice(restantes.indexOf(t), 1);
      semParar(loop(['proxima', '--vivos', '0']), restantes, `com ${restantes.length}`);
    }
    integrar('T4');
    const p2 = loop(['proxima', '--vivos', '0']);
    assert.equal(p2.rc, 0, p2.out);
    assert.equal(p2.j.acao.tipo, 'parar', `a única pendência é a T1 no teto: ${JSON.stringify(p2.j.acao)}`);
    assert.equal(p2.j.acao.motivo, 'teto_rodadas');
    assert.equal(p2.j.acao.task, 'T1');
    if (liberaTeto) assert.equal(p2.j.acao.liberacao.oferecer, true, `libera_teto ligado: a pergunta de liberação é oferecida à Sombra ${JSON.stringify(p2.j.acao.liberacao)}`);
    else assert.deepEqual([p2.j.acao.liberacao.oferecer, p2.j.acao.liberacao.motivo], [false, 'libera_teto_desligado'], 'libera_teto desligado: a T1 vai ao dono, sem pergunta');
    assert.equal(ler(E).filter((x) => x.tipo === 'loop.parar').length, 0, 'proxima só sugere: nenhum loop.parar gravado');

    // 3. a Sombra adia a T1 com fonte (REQ-ENT-2); sem fonte seria recusado e viraria item do dono
    const semFonte = loop(['adiar', 'T1', '--motivo', 'fora do escopo desta entrega', '--origem', 'sombra']);
    assert.notEqual(semFonte.rc, 0, 'c8: sem --fonte a Sombra não adia');
    assert.equal(ler(E).filter((x) => x.tipo === 'task.fora').length, 0, 'c8: recusado sem gravar');
    const ad = loop(['adiar', 'T1', '--motivo', 'fora do escopo desta entrega', '--origem', 'sombra', '--fonte', 'docs/spec.md:3']);
    assert.equal(ad.rc, 0, ad.out);
    assert.deepEqual([ad.j.ok, ad.j.task, ad.j.estado, ad.j.origem], [true, 'T1', 'adiada', 'sombra']);

    // 4. c7: `concluir`, sem `parar` nenhum, a adiada fora do lote do dono
    const p3 = loop(['proxima', '--vivos', '0']);
    assert.equal(p3.rc, 0, p3.out);
    assert.deepEqual(p3.j.acao, { tipo: 'concluir' }, 'c7: a entrega chega a concluir com a task adiada');
    assert.deepEqual(p3.j.lote ?? [], [], 'c7: a adiada não é item do dono');
    assert.equal(ler(E).filter((x) => x.tipo === 'loop.parar').length, 0, 'c7: nenhum loop.parar no diário inteiro');

    // 5. c8: o painel (com o plano) tira a adiada do denominador do PRONTO: 3 de 3, nunca 3 de 4
    const r = spawnSync(process.execPath, [PAINEL, 'estado', '--entrega', 'GM-90', '--agentes'], { cwd: d, input: JSON.stringify({ session_id: SID, agentes: [] }), encoding: 'utf8', env: env(), timeout: TETO });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const e = JSON.parse(r.stdout).estado;
    assert.equal(e.pronto?.total, 3, `c8: a adiada fora do total do PRONTO ${JSON.stringify(e.pronto)}`);
    assert.equal(e.pronto?.integradas, 3, `c8: 3 de 3 feitas ${JSON.stringify(e.pronto)}`);
    assert.equal(e.parar, null, 'c7: o painel não diz PAROU');
    assert.ok(!e.depende.some((i) => /T1/.test(i.motivo)), `c8: a adiada fora do DEPENDE ${JSON.stringify(e.depende)}`);
    assert.deepEqual(e.plano.tasks.map((t) => t.id), ['T2', 'T3', 'T4'], 'c8: a T1 adiada não é task do alvo do painel');
    assert.deepEqual([e.plano.feitas, e.plano.total], [3, 3], 'c8: 3 de 3 no plano do painel');

    // c9: a cópia é a única coisa que o teste escreveu
    assert.deepEqual(fotoDoCheckout(), antes, 'c9: o checkout real ficou intocado');
    assert.ok(readdirSync(E).length > 0);
  });
}

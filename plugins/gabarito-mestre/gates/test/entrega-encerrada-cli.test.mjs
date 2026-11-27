/**
 * GM-15 T8 (REQ-ENT-1 d): o painel com a entrega encerrada, pelos adaptadores reais (`painel.mjs medir|estado|texto`, `stop-loop.mjs`).
 *
 * - `entregue-sai-do-alvo` (P9, obrigação herdada da review T3 r1): o diário de task da GM-14 (fixture eta-gm14, eventos e plano reais) mais
 *   pendência, ideia e consulta à Sombra sem decisão ⇒ `painel.mjs medir` com o `gh` de fixture da T4 mais o #30 (virada final; o #22 alpha.1 não encerra, r.13p) grava `entrega.encerrada` ⇒
 *   `painel.mjs estado` sem PRONTO, DEPENDE, ATENÇÃO, PAROU nem pergunta da entrega ⇒ `painel.mjs texto` em 1 linha ⇒ `stop-loop.mjs` mudo.
 * - `pendencia-feita-some` / `pendencia-vista-some` (S3): a resposta do dono gravada numa sessão de nome que ordena ANTES de `loop` fecha a nota.
 * - `seguir-oferece-proxima` (as 3 ordens), `consultas-sombra-somem-com-entregue`, `linha-entregue-sem-regex-tecnica`.
 *
 * MUTAÇÕES (nomeadas no plano): M8a ATENÇÃO de consultas mantido com a entrega encerrada · M8b próxima oferecendo spec já encerrada ·
 * M8c pendência "feito" listada.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { raizSegura } from './_raiz-segura.mjs';
import { append, ler } from '../dist/diario.js';
import { entregaPublicada, SESSAO_QUALQUER } from '../dist/guarda.js';
import { botoesPorLinha, estadoParaDesenho, linhasDaPane } from '../../mod/painel.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PAINEL = join(AQUI, '..', 'scripts', 'painel.mjs');
const STOP = join(AQUI, '..', 'scripts', 'stop-loop.mjs');
const GH_ENC = join(AQUI, 'fixtures', 'gh-encerramento');
const GM14 = join(AQUI, 'fixtures', 'eta-gm14');
const SID = 'sessao-1';

const GIT_ENV = { ...process.env, HOME: tmpdir(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'user.useConfigOnly=true', ...a], { cwd, encoding: 'utf8', env: GIT_ENV }).trim();

/** Env sem `GABARITO_*` nem `CLAUDE_PROJECT_DIR` herdados; `gh` = o de fixture da T4. */
function env(extra = {}) {
  const e = { ...process.env, GIT_OPTIONAL_LOCKS: '0', PATH: `${GH_ENC}:${process.env.PATH}` };
  for (const k of Object.keys(e)) if (k.startsWith('GABARITO_') || k === 'CLAUDE_PROJECT_DIR') delete e[k];
  return { ...e, ...extra };
}

/** Repo descartável com onboarding (o `medir` só grava com ele), na `branch`. */
function repo(branch) {
  const d = join(raizSegura(realpathSync(mkdtempSync(join(tmpdir(), 'entrega encerrada ')))), 'r');
  mkdirSync(d, { recursive: true });
  git(d, 'init', '-q', '-b', 'main');
  writeFileSync(join(d, 'harness.config.json'), '{}\n');
  git(d, 'add', 'harness.config.json');
  git(d, 'commit', '-q', '-m', 'onboarding');
  if (branch !== 'main') git(d, 'checkout', '-q', '-b', branch);
  return d;
}
const dirDe = (d, id) => join(d, '.harness', 'entregas', id);
function w(d, id, sessao, tipo, dados, ts, agente = 'orquestrador') {
  const r = append(dirDe(d, id), sessao, { ts, autor: 't@t', sessao, agente, tipo, dados });
  assert.ok(r.ok && r.gravado === 'evento', `preparo: ${tipo} ${JSON.stringify(r)}`);
}
function spec(d, nome, pbi, titulo) {
  mkdirSync(join(d, 'docs', 'superpowers', 'specs'), { recursive: true });
  writeFileSync(join(d, 'docs', 'superpowers', 'specs', nome), `# ${titulo}\n\nPBI: ${pbi}\n\n## Seção\n`);
}

/** O diário de task real da GM-14 (fixture eta-gm14), regravado por sessão (seq e hash novos, mesma ordem e `ts`), e o plano real. */
function diarioGm14(d) {
  mkdirSync(dirDe(d, 'GM-14'), { recursive: true });
  copyFileSync(join(GM14, 'plano.json'), join(dirDe(d, 'GM-14'), 'plano.json'));
  for (const l of readFileSync(join(GM14, 'eventos.jsonl'), 'utf8').trim().split('\n')) {
    const e = JSON.parse(l);
    w(d, 'GM-14', e.sessao, e.tipo, e.dados, e.ts, e.agente);
  }
  // GM-21 DT1: a GM-14 real fechou sem a T8 (o dono a cortou, `memória gm14-corte`); o fixture não tem o evento. Com plano aberto o PR não encerra mais, então o corte entra aqui
  // (T8 está aprovada, não integrada: `fora.cortada` é válido). Sem este evento é o caso `painel-plano-aberto-segue-identificado`.
  w(d, 'GM-14', 'loop', 'task.fora', { task: 'T8', como: 'cortada', motivo: 'cortada pelo dono no fechamento da GM-14', origem: 'dono' }, '2026-11-15T12:15:00.000Z', 'orquestrador');
}

const H = 'a'.repeat(64);
/** Itens da GM-14 que o dono veria com a entrega aberta: pendência e ideia (nota do implementador), consulta à Sombra sem decisão e a branch. */
function itensDaEntrega(d) {
  w(d, 'GM-14', 'loop', 'fato.medido', { chave: 'branch', fonte: 'git', valor: { nome: 'enabler/GM-14-clareza' } }, '2026-11-15T12:20:00.000Z');
  w(d, 'GM-14', 'loop', 'nota', { tipo: 'pendencia', texto: 'conferir a release no app desktop' }, '2026-11-15T12:21:00.000Z', 'implementador');
  w(d, 'GM-14', 'loop', 'nota', { tipo: 'ideia', texto: 'painel com tema claro' }, '2026-11-15T12:22:00.000Z', 'implementador');
  w(d, 'GM-14', 'loop', 'sombra.consulta', { pergunta_hash: H, req: 'REQ-HIG-1' }, '2026-11-15T12:23:00.000Z', 'sombra');
}

const entradaMod = (sessao = SID) => JSON.stringify({ session_id: sessao, agentes: [] });
function painel(d, args, { sessao = SID, extraEnv = {} } = {}) {
  const r = spawnSync(process.execPath, [PAINEL, ...args, '--agentes'], { cwd: d, input: entradaMod(sessao), encoding: 'utf8', env: env(extraEnv), timeout: 60_000 });
  return r;
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
// GM-15 T34 (r.13p): a fixture deixou de usar o título literal do #22 ("release(GM-14): 2.1.0-alpha.1 (next → main)") para encerrar a GM-14: PR de virada de pré-versão não encerra
// (a spec real da GM-14 não tem `Versão:`, alvo null). O PR que encerra aqui é o #30, a virada FINAL (título sem sufixo), somado ao `gh` de fixture por GH_PRS_EXTRA.
const PR30 = { number: 30, state: 'MERGED', baseRefName: 'main', headRefName: 'next', title: 'release(GM-14): 2.1.0 (next → main)', mergedAt: '2026-11-15T13:00:00Z' };
function medirCli(d) {
  const r = painel(d, ['medir'], { extraEnv: { GH_PRS_EXTRA: JSON.stringify([PR30]) } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout);
}
function stop(d, sessao = SID) {
  return spawnSync(process.execPath, [STOP], {
    cwd: d, input: JSON.stringify({ session_id: sessao, cwd: d, background_tasks: [] }), encoding: 'utf8', env: env({ CLAUDE_PROJECT_DIR: d }), timeout: 60_000,
  });
}
const NADA = 'nada depende de você';
const soNada = (e) => e.depende.every((i) => i.motivo === NADA);

test('entregue-sai-do-alvo: GM-14 + gh com a virada final #30 ⇒ medir grava entrega.encerrada ⇒ estado sem os itens da entrega ⇒ texto em 1 linha ⇒ Stop mudo', () => {
  const d = repo('enabler/GM-14-clareza');
  diarioGm14(d);
  itensDaEntrega(d);

  // controle: antes do medir, a entrega aberta mostra PRONTO, a pendência, a ideia e a consulta sem decisão
  const antes = estado(d);
  assert.equal(antes.entregue ?? null, null);
  assert.ok(antes.pronto !== null || antes.fase !== null, 'controle: a entrega aberta tem PRONTO ou FASE');
  assert.ok(antes.depende.some((i) => /conferir a release/.test(i.motivo)), `controle: pendência listada ${JSON.stringify(antes.depende)}`);
  assert.ok(antes.atencao.some((a) => /consulta à Sombra sem decisão/.test(a)), `controle: ATENÇÃO de consulta ${JSON.stringify(antes.atencao)}`);
  assert.ok(texto(d).length > 1, 'controle: o painel da entrega aberta tem mais de 1 linha');

  const m = medirCli(d);
  assert.equal(m.ok, true, JSON.stringify(m));
  const enc = ler(dirDe(d, 'GM-14')).filter((e) => e.tipo === 'entrega.encerrada');
  assert.deepEqual(enc.map((e) => e.dados), [{ entrega: 'GM-14', pr: 30, via: 'titulo', mergeado_em: '2026-11-15T13:00:00Z' }], 'o #22 (alpha.1) não encerra; o #30 (final) encerra');

  const e = estado(d);
  // r1 MAJOR-3: o release medido (v2.1.0-alpha.1, o último do repo) não é amarrado ao #22 ⇒ sem versão; nunca "2.1.0" recortado
  assert.deepEqual(e.entregue, { id: 'GM-14', versao: null }, 'release sem amarra ao PR não dá versão');
  assert.equal(e.pronto, null, 'PRONTO da entrega sai');
  assert.equal(e.parar, null);
  assert.equal(e.pergunta, null);
  assert.equal(e.perguntasMais, 0);
  // 0 item da GM-14 no DEPENDE: o único item é a oferta da próxima (as ideias "para a próxima", spec (d)(i)), com o botão "seguir" (r1 MAJOR-1)
  assert.deepEqual(e.depende, [{ nivel: 'dono', motivo: 'próxima entrega: decidir se a ideia vira a próxima entrega', acoes: [{ rotulo: 'seguir', comando: '/gabarito-mestre:gabarito-loop' }] }]);
  assert.deepEqual(e.atencao, [], 'ATENÇÃO sem item da entrega');
  assert.equal(e.umaLinha, null, 'a linha é a de entregue, não a de "sem entrega em curso"');

  const ls = texto(d);
  assert.equal(ls.length, 1, ls.join('\n'));
  assert.equal(ls[0], '◆ GABARITO · GM-14 entregue · próxima: decidir se a ideia vira a próxima entrega');

  const s = stop(d);
  assert.equal(s.status, 0, s.stderr);
  assert.equal(s.stdout, '', 'Stop silencioso na entrega encerrada');
  assert.equal(s.stderr, '');
  assert.equal(ler(dirDe(d, 'GM-14')).filter((x) => x.tipo === 'loop.parar').length, 0);
});

test('entregue-sai-do-alvo (sessão em outra branch): em main, a GM-14 encerrada é a última conhecida e o painel é a mesma 1 linha', () => {
  const d = repo('main');
  diarioGm14(d);
  itensDaEntrega(d);
  assert.equal(medirCli(d).ok, true);
  const e = estado(d);
  assert.deepEqual(e.entregue, { id: 'GM-14', versao: null }, 'sem release medido na GM-14 (foi para _sem-id): sem versão');
  assert.equal(e.umaLinha, null);
  // r1 MAJOR-2: o `medir` desta sessão gravou em `_sem-id` e abriu a pergunta (b) da sessão; ela é do `_sem-id`, não da GM-14, e fica (com os blocos)
  assert.equal(e.pergunta?.gatilho, 'b', JSON.stringify(e.pergunta));
  assert.ok(e.depende.some((i) => i.motivo === 'próxima entrega: decidir se a ideia vira a próxima entrega'), JSON.stringify(e.depende));
  assert.ok(texto(d).length > 1);
});

test('entregue-sai-do-alvo (main sem nada no _sem-id): a GM-14 encerrada, última conhecida, é a mesma 1 linha', () => {
  const d = repo('main');
  diarioGm14(d);
  itensDaEntrega(d);
  w(d, 'GM-14', 'loop', 'entrega.encerrada', { entrega: 'GM-14', pr: 22, via: 'titulo', mergeado_em: '2026-11-15T12:00:00Z' }, '2026-11-15T12:30:00.000Z', 'painel');
  const e = estado(d);
  assert.deepEqual(e.entregue, { id: 'GM-14', versao: null });
  assert.deepEqual(texto(d), ['◆ GABARITO · GM-14 entregue · próxima: decidir se a ideia vira a próxima entrega']);
});

test('ultima-conhecida-nao-zera-sem-id (r1 MAJOR-2): em main, pendência e consulta à Sombra do _sem-id ficam com a GM-14 encerrada', () => {
  const d = repo('main');
  diarioGm14(d);
  w(d, 'GM-14', 'loop', 'entrega.encerrada', { entrega: 'GM-14', pr: 22, via: 'titulo', mergeado_em: '2026-11-15T12:00:00Z' }, '2026-11-15T12:30:00.000Z', 'painel');
  w(d, '_sem-id', 'loop', 'nota', { tipo: 'pendencia', texto: 'renovar o certificado' }, '2026-11-15T12:40:00.000Z', 'implementador');
  w(d, '_sem-id', 'loop', 'sombra.consulta', { pergunta_hash: H, req: 'REQ-A-1' }, '2026-11-15T12:41:00.000Z', 'sombra');
  const e = estado(d);
  assert.deepEqual(e.entregue, { id: 'GM-14', versao: null }, 'controle: a GM-14 encerrada é a última conhecida');
  assert.ok(e.depende.some((i) => i.motivo === 'renovar o certificado'), `a pendência do _sem-id continua: ${JSON.stringify(e.depende)}`);
  assert.ok(e.atencao.includes('1 consulta à Sombra sem decisão registrada'), `a ATENÇÃO do _sem-id continua: ${JSON.stringify(e.atencao)}`);
  const ls = texto(d);
  assert.ok(ls.length > 1 && ls.some((l) => /renovar o certificado/.test(l)), ls.join('\n'));
});

test('consultas-sombra-somem-com-entregue: "N consultas à Sombra sem decisão" sai do ATENÇÃO só com a entrega encerrada (M8a)', () => {
  const d = repo('enabler/GM-30-x');
  w(d, 'GM-30', 'loop', 'sombra.consulta', { pergunta_hash: H, req: 'REQ-A-1' }, '2026-11-15T10:00:00.000Z', 'sombra');
  w(d, 'GM-30', 'loop', 'sombra.consulta', { pergunta_hash: 'b'.repeat(64), req: 'REQ-A-1' }, '2026-11-15T10:01:00.000Z', 'sombra');
  assert.ok(estado(d).atencao.includes('2 consultas à Sombra sem decisão registrada'), 'controle: aberta, a ATENÇÃO aparece');
  w(d, 'GM-30', 'loop', 'entrega.encerrada', { entrega: 'GM-30', pr: 40, via: 'head', mergeado_em: '2026-11-15T11:00:00.000Z' }, '2026-11-15T11:00:01.000Z', 'painel');
  const e = estado(d);
  assert.deepEqual(e.entregue, { id: 'GM-30', versao: null });
  assert.deepEqual(e.atencao, []);
});

test('versao-do-encerramento-vence-o-release: entrega.encerrada com versao ⇒ "(versão X.Y.Z)" dela', () => {
  const d = repo('enabler/GM-31-x');
  w(d, 'GM-31', 'loop', 'fato.medido', { chave: 'release', fonte: 'gh', valor: { tag: 'v9.9.9' } }, '2026-11-15T10:00:00.000Z');
  w(d, 'GM-31', 'loop', 'entrega.encerrada', { entrega: 'GM-31', pr: 41, via: 'head', mergeado_em: '2026-11-15T11:00:00.000Z', versao: '3.0.0' }, '2026-11-15T11:00:01.000Z', 'painel');
  assert.deepEqual(estado(d).entregue, { id: 'GM-31', versao: '3.0.0' });
  assert.match(texto(d)[0], /^(◆ )?GABARITO · GM-31 entregue \(versão 3\.0\.0\) · /);
});

test('seguir-oferece-proxima: spec com PBI sem encerramento mais nova ⇒ ideias ⇒ "nenhuma próxima anotada" (M8b)', () => {
  // 3ª ordem: nada anotado
  const d = repo('enabler/GM-32-x');
  w(d, 'GM-32', 'loop', 'entrega.encerrada', { entrega: 'GM-32', pr: 42, via: 'head', mergeado_em: '2026-11-15T11:00:00.000Z' }, '2026-11-15T11:00:01.000Z', 'painel');
  let e = estado(d);
  assert.deepEqual(e.proxima, { tipo: 'nenhuma', texto: 'nenhuma próxima anotada', acoes: [] });
  assert.deepEqual(texto(d), ['GABARITO · GM-32 entregue · nenhuma próxima anotada']);

  // 2ª ordem: ideia do dono (a do orquestrador é lembrete dele e não conta)
  w(d, 'GM-32', 'loop', 'nota', { tipo: 'ideia', texto: 'lembrete do orquestrador' }, '2026-11-15T11:01:00.000Z', 'orquestrador');
  assert.equal(estado(d).proxima.tipo, 'nenhuma', 'ideia do orquestrador não é próxima');
  w(d, 'GM-32', 'loop', 'nota', { tipo: 'ideia', texto: 'uma ideia' }, '2026-11-15T11:02:00.000Z', 'implementador');
  w(d, 'GM-32', 'loop', 'nota', { tipo: 'ideia', texto: 'outra ideia' }, '2026-11-15T11:03:00.000Z', 'implementador');
  e = estado(d);
  assert.deepEqual(e.proxima, { tipo: 'ideias', texto: 'decidir se as 2 ideias viram a próxima entrega', acoes: [{ rotulo: 'seguir', comando: '/gabarito-mestre:gabarito-loop' }] });

  // 1ª ordem: a spec mais nova com PBI sem entrega.encerrada; a já encerrada (GM-33) e a própria (GM-32) nunca são oferecidas
  spec(d, '2026-11-01-antiga.md', 'GM-34', 'Antiga');
  spec(d, '2026-11-20-encerrada.md', 'GM-33', 'Já entregue');
  spec(d, '2026-11-10-nova.md', 'GM-35', 'Painel antigo');
  spec(d, '2026-11-30-propria.md', 'GM-32', 'A própria');
  w(d, 'GM-33', 'loop', 'entrega.encerrada', { entrega: 'GM-33', pr: 43, via: 'head', mergeado_em: '2026-11-14T11:00:00.000Z' }, '2026-11-14T11:00:01.000Z', 'painel');
  // GM-20 T7 (REQ-PRX-1, DT15): o corte é a spec da última entregue (2026-11-30); GM-35 (2026-11-10) e GM-34 são mais antigas ⇒ não são "próxima" (cai nas ideias)
  assert.equal(estado(d).proxima.tipo, 'ideias', 'spec mais antiga que a última entregue fica fora, pela CLI');
  assert.doesNotMatch(texto(d)[0], /próxima: GM-3[45]/);
  // a spec mais nova que o corte (2026-12-05) é a oferecida
  spec(d, '2026-12-05-nova.md', 'GM-35', 'Painel `novo` com_tema');
  e = estado(d);
  assert.deepEqual(e.proxima, { tipo: 'spec', texto: 'GM-35 Painel novo com tema', acoes: [{ rotulo: 'seguir', comando: '/gabarito-mestre:gabarito-loop' }] });
  // GM-15 T32 (emenda 4): a linha única segue 1 linha e é a 1ª (item do dono com o botão "seguir"); com 2 PBIs entregues (GM-32, GM-33) o projeto vem abaixo dela
  const ls = texto(d);
  assert.equal(ls[0], '◆ GABARITO · GM-32 entregue · próxima: GM-35 Painel novo com tema');
  assert.equal(ls.filter((l) => /^(◆ )?GABARITO/.test(l)).length, 1);
  assert.match(ls[1], /^PROJETO {2}2 de 2 PBIs feitos/);
  // GM-16 T4 (REQ-PRJ-3 a): os 2 PBIs feitos saem do desenho e entra "✓ 2 feitos" logo depois dos totais (ls[1..2], sem a linha de estimada); nenhuma linha de GM-32/GM-33 sobra
  assert.match(ls[2], /^ {2}previsão /);
  assert.deepEqual(ls.slice(3), ['  ✓ 2 feitos']);
  assert.ok(ls.every((l, i) => i === 0 || !/GM-3[23]/.test(l)), ls.join('\n'));
});

test('linha-entregue-sem-regex-tecnica: a linha de entregue não tem comando, crase, evento, snake_case nem caminho', () => {
  const d = repo('enabler/GM-36-x');
  spec(d, '2026-11-10-x.md', 'GM-37', 'Título com `crase` --flag /gabarito-mestre:loop e entrega.encerrada snake_case node x.mjs');
  w(d, 'GM-36', 'loop', 'entrega.encerrada', { entrega: 'GM-36', pr: 44, via: 'head', mergeado_em: '2026-11-15T11:00:00.000Z', versao: '1.2.3' }, '2026-11-15T11:00:01.000Z', 'painel');
  for (const largura of [40, 80, 200]) {
    const ls = texto(d, largura);
    assert.equal(ls.length, 1, ls.join('\n'));
    if (largura >= 80) assert.match(ls[0], /^◆ GABARITO · GM-36 entregue \(versão 1\.2\.3\) · próxima: GM-37 /);
    for (const re of [/`/, /--/, /\/[a-z]/, /\b[a-z]+_[a-z]+\b/, /\b[a-z]+\.[a-z]+\b/, /\bnode\b/]) assert.doesNotMatch(ls[0], re, `${largura}: ${ls[0]}`);
    assert.ok([...ls[0]].length <= largura, `${largura}: ${ls[0]}`);
  }
});

test('entregue-com-agente-vivo: o painel volta aos blocos, ainda sem PRONTO nem ATENÇÃO da entrega', () => {
  const d = repo('enabler/GM-38-x');
  w(d, 'GM-38', 'loop', 'sombra.consulta', { pergunta_hash: H, req: 'REQ-A-1' }, '2026-11-15T10:00:00.000Z', 'sombra');
  w(d, 'GM-38', 'loop', 'entrega.encerrada', { entrega: 'GM-38', pr: 45, via: 'head', mergeado_em: '2026-11-15T11:00:00.000Z' }, '2026-11-15T11:00:01.000Z', 'painel');
  const r = spawnSync(process.execPath, [PAINEL, 'estado', '--agentes'], {
    cwd: d, encoding: 'utf8', env: env(), timeout: 60_000,
    input: JSON.stringify({ session_id: SID, agentes: [{ id: 'abcdef0123456789', type: 'general-purpose', description: 'uma pesquisa', status: 'running' }] }),
  });
  const e = JSON.parse(r.stdout).estado;
  assert.deepEqual(e.entregue, { id: 'GM-38', versao: null });
  assert.equal(e.agora.agentes.length, 1);
  assert.deepEqual(e.atencao.filter((a) => /Sombra/.test(a)), []);
});

test('entregue-sem-pronto-com-plano-casado: com --entrega (o plano entra na projeção) a entrega encerrada não mostra PRONTO', () => {
  const d = repo('enabler/GM-41-x');
  mkdirSync(dirDe(d, 'GM-41'), { recursive: true });
  writeFileSync(join(dirDe(d, 'GM-41'), 'plano.json'), JSON.stringify({ entrega: 'GM-41', tasks: [{ id: 'T1', deps: [], arquivos: ['a.ts'] }, { id: 'T2', deps: [], arquivos: ['b.ts'] }] }));
  w(d, 'GM-41', 'loop', 'task.iniciada', { task: 'T1', papel: 'implementador' }, '2026-11-15T09:00:00.000Z');
  const comEntrega = () => {
    const r = spawnSync(process.execPath, [PAINEL, 'estado', '--entrega', 'GM-41', '--agentes'], { cwd: d, input: entradaMod(), encoding: 'utf8', env: env(), timeout: 60_000 });
    return JSON.parse(r.stdout).estado;
  };
  assert.deepEqual(comEntrega().pronto?.total, 2, 'controle: aberta, PRONTO 0 de 2');
  w(d, 'GM-41', 'loop', 'entrega.encerrada', { entrega: 'GM-41', pr: 46, via: 'head', mergeado_em: '2026-11-15T11:00:00.000Z' }, '2026-11-15T11:00:01.000Z', 'painel');
  const e = comEntrega();
  assert.deepEqual(e.entregue, { id: 'GM-41', versao: null });
  assert.equal(e.pronto, null);
});

// ── S3: "posterior" é a ordem causal (ordenar por ts), não a ordem dos arquivos ──────────────────────────────────────────────────────────
const UUID = '01db6bdc-aaaa-4bbb-8ccc-0123456789ab'; // ordena antes de `loop` pelo nome do arquivo (caso medido no S3)

test('pendencia-feita-some: "feito" gravado na sessão do dono (arquivo que ordena antes de events.loop) fecha a pendência (M8c)', () => {
  const d = repo('enabler/GM-39-x');
  w(d, 'GM-39', 'loop', 'nota', { tipo: 'pendencia', texto: 'conferir o app desktop' }, '2026-11-15T10:00:00.000Z', 'implementador');
  assert.ok(estado(d).depende.some((i) => i.motivo === 'conferir o app desktop'), 'controle: aberta antes da resposta');
  w(d, 'GM-39', UUID, 'dono.resposta', { pergunta: 'loop:1', opcao: 1, rotulo: 'feito' }, '2026-11-15T10:05:00.000Z', 'dono');
  const e = estado(d);
  assert.ok(!e.depende.some((i) => /conferir o app desktop/.test(i.motivo)), JSON.stringify(e.depende));
  assert.ok(texto(d).every((l) => !/conferir o app desktop/.test(l)));
});

test('pendencia-vista-some: "visto" gravado na sessão do dono fecha as ideias', () => {
  const d = repo('enabler/GM-40-x');
  w(d, 'GM-40', 'loop', 'nota', { tipo: 'ideia', texto: 'uma ideia' }, '2026-11-15T10:00:00.000Z', 'implementador');
  assert.ok(estado(d).depende.some((i) => /ideia vira a próxima entrega/.test(i.motivo)), 'controle: aberta antes do visto');
  w(d, 'GM-40', UUID, 'dono.resposta', { pergunta: 'loop:1', opcao: 1, rotulo: 'visto' }, '2026-11-15T10:05:00.000Z', 'dono');
  assert.ok(!estado(d).depende.some((i) => /ideia/.test(i.motivo)));
});

// ── review r1 MAJOR-1: o botão "seguir" chega ao dono pelo caminho que o mod JÁ desenha (o item do DEPENDE com `acoes`) ──────────────────────
/** As linhas e os botões como o mod os desenha na Pane (funções puras reais de `mod/painel.mjs`, sem cópia). */
function botoesDoMod(e, largura = 120) {
  const linhas = linhasDaPane(estadoParaDesenho(e), { preset: 'esquadrao' }, largura, {});
  return { linhas: linhas.map((l) => l.map((s) => s.texto).join('')), mapa: botoesPorLinha(e, '/raiz', linhas) };
}
const SEGUIR = { rotulo: 'seguir', comando: '/gabarito-mestre:gabarito-loop' };

test('seguir-chega-ao-mod: a próxima vira item do DEPENDE com a ação "seguir" e o mod desenha o botão na linha única', () => {
  const d = repo('enabler/GM-42-x');
  spec(d, '2026-11-10-nova.md', 'GM-43', 'Painel novo');
  w(d, 'GM-42', 'loop', 'entrega.encerrada', { entrega: 'GM-42', pr: 47, via: 'head', mergeado_em: '2026-11-15T11:00:00.000Z' }, '2026-11-15T11:00:01.000Z', 'painel');
  const e = estado(d);
  // A próxima (GM-43) NÃO é item da entrega encerrada (GM-42): é a oferta da spec (d)(i). O aceite "0 itens da encerrada no DEPENDE" segue valendo:
  // o único item é o da próxima, com o botão "seguir".
  assert.deepEqual(e.depende, [{ nivel: 'dono', motivo: 'próxima entrega: GM-43 Painel novo', acoes: [SEGUIR] }]);
  const { linhas, mapa } = botoesDoMod(e);
  assert.equal(linhas.length, 1, linhas.join('\n'));
  assert.match(linhas[0], /GM-42 entregue · próxima: GM-43 Painel novo$/);
  assert.deepEqual([...mapa.entries()], [[0, [SEGUIR]]], 'o mod põe o botão "seguir" na linha única');
});

test('seguir-chega-ao-mod (nenhuma): sem próxima anotada não há item nem botão', () => {
  const d = repo('enabler/GM-44-x');
  w(d, 'GM-44', 'loop', 'entrega.encerrada', { entrega: 'GM-44', pr: 48, via: 'head', mergeado_em: '2026-11-15T11:00:00.000Z' }, '2026-11-15T11:00:01.000Z', 'painel');
  const e = estado(d);
  assert.ok(soNada(e), JSON.stringify(e.depende));
  const { linhas, mapa } = botoesDoMod(e);
  assert.deepEqual(linhas, ['GABARITO · GM-44 entregue · nenhuma próxima anotada']);
  assert.equal(mapa.size, 0);
});

test('versao-nunca-truncada (r1 MAJOR-3): o caso real, tag v2.1.0-alpha.2, encerramento com versao 2.1.0-alpha.2 (a forma do evento é sem `v`) ⇒ "(versão 2.1.0-alpha.2)", nunca "2.1.0"', () => {
  const d = repo('hotfix/GM-15-alpha2');
  w(d, 'GM-15', 'loop', 'fato.medido', { chave: 'release', fonte: 'gh', valor: { tag: 'v2.1.0-alpha.1' } }, '2026-11-15T19:00:00.000Z');
  w(d, 'GM-15', 'loop', 'entrega.encerrada', { entrega: 'GM-15', pr: 23, via: 'titulo', mergeado_em: '2026-11-15T20:00:00Z', versao: '2.1.0-alpha.2' }, '2026-11-15T20:00:01.000Z', 'painel');
  assert.deepEqual(estado(d).entregue, { id: 'GM-15', versao: '2.1.0-alpha.2' });
  const [l] = texto(d);
  assert.match(l, /^GABARITO · GM-15 entregue \(versão 2\.1\.0-alpha\.2\) · nenhuma próxima anotada$/);
  assert.doesNotMatch(l, /versão 2\.1\.0\)/);
});

/**
 * GM-20 review final r1 MAJOR-1 (D-G47, emenda 1 de REQ-CRD-2): base `next`, entrega encerrada com sha e nenhum PR em main que o contenha ⇒ o
 * lembrete "levar next para main" segue no DEPENDE do painel, o mesmo item do `lote` de `loop.mjs proxima` (uma regra só: `loteDoDono`).
 * Fixture de `.claude-tmp/gm20/rf-virada.mjs`: repo com origin, config de origin com `entrega.base: next`, plano de 1 task. Lê a SAÍDA real do painel.
 */
test('virada-segue-depois-da-encerrada: painel.mjs estado/texto mantêm "levar next para main" como o lote do proxima', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'rf-virada-')));
  const d = join(raizSegura(base), 'repo');
  mkdirSync(d, { recursive: true });
  const BR = 'feat/GM-12-painel';
  git(d, 'init', '-q', '-b', BR);
  mkdirSync(join(d, 'docs'));
  writeFileSync(join(d, 'docs', 'spec.md'), '# T\n\nc\n');
  writeFileSync(join(d, 'harness.config.json'), JSON.stringify({ entrega: { base: 'next', autonomia: false }, sombra: { julga_emendas: false, libera_teto: false } }));
  git(d, 'add', '.');
  git(d, 'commit', '-q', '-m', 'i');
  const bare = join(base, 'origin.git');
  mkdirSync(bare);
  git(bare, 'init', '-q', '--bare', '-b', BR);
  git(d, 'remote', 'add', 'origin', bare);
  git(d, 'push', '-q', 'origin', BR);
  git(d, 'remote', 'set-head', 'origin', BR);
  mkdirSync(dirDe(d, 'GM-12'), { recursive: true });
  writeFileSync(join(dirDe(d, 'GM-12'), 'plano.json'), JSON.stringify({ entrega: 'GM-12', spec: 'docs/spec.md', tasks: [{ id: 'T1', titulo: 'a', deps: [], arquivos: ['src/t1.txt'] }] }));
  w(d, 'GM-12', 'loop', 'task.iniciada', { task: 'T1', papel: 'implementador' }, '2026-11-09T12:00:01.000Z');
  w(d, 'GM-12', 'painel', 'entrega.encerrada', { entrega: 'GM-12', pr: 31, via: 'head', mergeado_em: '2026-11-09T12:30:00Z', sha: 'a'.repeat(40) }, '2026-11-09T12:00:02.000Z', 'painel');
  const VIRADA = 'no fim da entrega: levar next para main';
  const l = spawnSync(process.execPath, [join(AQUI, '..', 'scripts', 'loop.mjs'), 'proxima'], { cwd: d, encoding: 'utf8', env: env() });
  const lote = JSON.parse(l.stdout.trim().split('\n').at(-1)).lote.map((i) => i.motivo);
  assert.deepEqual(lote, [VIRADA], 'o proxima mantém o lembrete');
  const e = estado(d);
  assert.deepEqual(e.depende.map((i) => i.motivo), lote, 'o DEPENDE do painel lista o mesmo lote');
  assert.ok(texto(d, 100).some((x) => /para main/.test(x)), 'o texto do painel mostra o lembrete');
});

// ── GM-21 T1 (REQ-ENC-1, emenda 1): plano aberto não tira a entrega do painel nem a encerra ──────────────────────────────────────────────────
// MUTAÇÕES: ME1-d (a fase PR de `trilhaDe` ignora o plano) e ME1-g (`entregaPublicada` volta a `plano: {tasks: []}`) derrubam este caso e `publicada-nao-com-plano-aberto`.
const PLANO7 = { entrega: 'PBI-7', tasks: ['T1', 'T2'].map((id) => ({ id, deps: [], arquivos: [`src/${id}.txt`], reqs: ['REQ-A-1'], titulo: `Task ${id}` })) };
const PR10_7 = { number: 10, state: 'MERGED', baseRefName: 'main', headRefName: 'docs/PBI-7-plano', title: 'docs(PBI-7): plano', mergedAt: '2026-11-20T12:00:00Z' };
const PR11_7 = { number: 11, state: 'OPEN', baseRefName: 'main', headRefName: 'feat/PBI-7-loop', title: 'feat(PBI-7): loop', mergedAt: null };
function pbi7(branch) {
  const d = repo(branch);
  mkdirSync(dirDe(d, 'PBI-7'), { recursive: true });
  writeFileSync(join(dirDe(d, 'PBI-7'), 'plano.json'), JSON.stringify(PLANO7));
  const t = (min) => new Date(Date.parse('2026-11-19T10:00:00.000Z') - min * 60_000).toISOString();
  w(d, 'PBI-7', 'loop', 'task.iniciada', { task: 'T1', papel: 'implementador' }, t(4));
  w(d, 'PBI-7', 'loop', 'task.concluida', { task: 'T1' }, t(3));
  w(d, 'PBI-7', 'loop', 'task.iniciada', { task: 'T1', papel: 'revisor' }, t(2));
  w(d, 'PBI-7', 'loop', 'review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, major: 0, blocker: 0 }, t(1));
  w(d, 'PBI-7', 'loop', 'task.integrada', { task: 'T1' }, t(0));
  return d;
}
const medirPbi7 = (d, prs) => {
  const r = painel(d, ['medir'], { extraEnv: { GH_PRS_EXTRA: JSON.stringify(prs) } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, true, r.stdout);
  return j;
};

test('painel-plano-aberto-segue-identificado (P9, emenda 1): só o PR do plano (#10) mergeado, T2 aberta ⇒ o estado segue na PBI-7 (PRONTO 1 de 2, próxima T2), sem sair para "entregue"; com o #11 aberto é o mesmo', () => {
  for (const branch of ['feat/PBI-7-loop', 'docs/PBI-7-plano']) {
    const d = pbi7(branch);
    const m = medirPbi7(d, [PR10_7]);
    assert.equal(ler(dirDe(d, 'PBI-7')).filter((e) => e.tipo === 'entrega.encerrada').length, 0, `${branch}: nada encerrado`);
    assert.deepEqual(ler(dirDe(d, 'PBI-7')).filter((e) => e.tipo === 'fato.medido' && e.dados.chave === 'pr').map((e) => e.dados.valor.numero), [10], 'o PR #10 segue gravado');
    assert.equal(m.avisos, undefined, `${branch}: o medir não carrega o aviso (o mod descarta a saída dele)`);
    // MAJOR-1 (r1): o aviso sai no `painel.mjs estado` (onde o dono lê), com T2 e o comando, 1 entrada só, a cada leitura (o estado não grava, não gasta cota)
    const lerAvisos = () => { const r = painel(d, ['estado']); assert.equal(r.status, 0, r.stdout + r.stderr); return JSON.parse(r.stdout).avisos.filter((a) => /não encerra a PBI-7/.test(a)); };
    assert.deepEqual(lerAvisos(), ['PR #10 mergeado não encerra a PBI-7: tasks abertas T2; se a entrega acabou, /gabarito-mestre:encerrar PBI-7 10'], branch);
    assert.equal(lerAvisos().length, 1, `${branch}: a 2ª leitura do estado traz o mesmo, sem duplicar`);
    const e = estado(d);
    assert.equal(e.entregue ?? null, null, `${branch}: a entrega não virou "entregue"`);
    assert.equal(e.id, 'PBI-7', `${branch}: o plano não é descartado`);
    assert.equal(e.modo, 'entrega');
    assert.equal(e.trilha.identificada, true, branch);
    assert.equal(e.trilha.progresso, '1 de 2 tasks integradas');
    assert.deepEqual([e.plano.feitas, e.plano.total], [1, 2], `${branch}: PRONTO 1 de 2`);
    assert.deepEqual(e.plano.tasks.map((t) => [t.id, t.estado]), [['T1', 'integrada'], ['T2', 'pendente']], `${branch}: a próxima é a T2`);
    // com o PR do loop aberto (#11) o estado é o mesmo (regressão)
    const m2 = medirPbi7(d, [PR10_7, PR11_7]);
    assert.equal(m2.avisos, undefined);
    // com o #11 aberto o aviso segue (a emenda 6 não tem ramo de PR aberto): o #10 é o último mergeado e o plano segue aberto
    assert.equal(lerAvisos().length, 1, `${branch}: aviso inalterado com o #11`);
    const e2 = estado(d);
    assert.equal(e2.entregue ?? null, null);
    assert.equal(e2.id, 'PBI-7');
    assert.deepEqual([e2.plano.feitas, e2.plano.total], [1, 2]);
  }
});

// MAJOR-2 (r1): o encerramento do dono vale em TODO leitor: com `entrega.encerrada` (via dono) e T2 aberta, o painel mostra a entrega como a base (publicada: modo 'projeto'), igual à guarda.
test('painel-encerrada-do-dono-com-plano-aberto (P9, r1 MAJOR-2): entrega.encerrada do dono + T2 aberta ⇒ o estado é o mesmo do plano fechado; sem o encerramento, segue em curso', () => {
  const dono = (d) => w(d, 'PBI-7', 'loop', 'entrega.encerrada', { entrega: 'PBI-7', pr: 10, via: 'dono', mergeado_em: '2026-11-20T12:00:00.000Z' }, '2026-11-20T12:30:00.000Z', 'dono');
  const campos = (e) => [e.modo, e.id, e.pronto, e.trilha.identificada, e.parar];
  const d = pbi7('feat/PBI-7-loop');
  medirPbi7(d, [PR10_7]);
  assert.deepEqual([estado(d).modo, estado(d).id], ['entrega', 'PBI-7'], 'controle: sem o encerramento do dono segue em curso');
  dono(d);
  assert.equal(entregaPublicada(d, 'PBI-7', SESSAO_QUALQUER), true, 'a guarda dá publicada');
  const base = pbi7('feat/PBI-7-loop');
  medirPbi7(base, [PR10_7]);
  w(base, 'PBI-7', 'loop', 'task.fora', { task: 'T2', como: 'cortada', motivo: 'fora do corte', origem: 'dono' }, '2026-11-19T11:00:00.000Z');
  const e = estado(d);
  assert.deepEqual(campos(e), campos(estado(base)), 'igual à base (plano fechado, publicada)');
  assert.deepEqual([e.modo, e.trilha.identificada, e.pronto], ['projeto', false, null]);
});

// ME1-f (emenda 6): o `medir` emite o aviso, ou o aviso continua com plano fechado/encerrada ⇒ este teste cai.
test('aviso-no-estado-some-ao-encerrar-ou-fechar (emenda 6, DT1, P9): aviso em 2 leituras seguidas do estado; o medir não traz; some com entrega.encerrada do dono; some com a T2 fora do plano', () => {
  const AV = /^PR #10 mergeado não encerra a PBI-7: tasks abertas T2; se a entrega acabou, \/gabarito-mestre:encerrar PBI-7 10$/;
  const avisos = (d) => { const r = painel(d, ['estado']); assert.equal(r.status, 0, r.stdout + r.stderr); return JSON.parse(r.stdout).avisos.filter((a) => /não encerra a PBI-7/.test(a)); };
  const d = pbi7('feat/PBI-7-loop');
  assert.equal(medirPbi7(d, [PR10_7]).avisos, undefined, 'o medir não emite o aviso');
  for (const n of [1, 2]) { const a = avisos(d); assert.equal(a.length, 1, `leitura ${n}`); assert.match(a[0], AV); }
  assert.equal(medirPbi7(d, [PR10_7]).avisos, undefined, 'nem a 2ª medição');
  assert.equal(avisos(d).length, 1, 'medir de novo não gasta o aviso do estado');
  // some com o encerramento do dono (T2 segue aberta)
  w(d, 'PBI-7', 'loop', 'entrega.encerrada', { entrega: 'PBI-7', pr: 10, via: 'dono', mergeado_em: '2026-11-20T12:00:00.000Z' }, '2026-11-20T12:30:00.000Z', 'dono');
  assert.deepEqual(avisos(d), [], 'entrega.encerrada do dono');
  // some ao fechar as tasks abertas
  const f = pbi7('feat/PBI-7-loop');
  medirPbi7(f, [PR10_7]);
  assert.equal(avisos(f).length, 1, 'controle: com T2 aberta o aviso existe');
  w(f, 'PBI-7', 'loop', 'task.fora', { task: 'T2', como: 'cortada', motivo: 'fora do corte', origem: 'dono' }, '2026-11-19T11:00:00.000Z');
  assert.deepEqual(avisos(f), [], 'T2 fora do plano');
});

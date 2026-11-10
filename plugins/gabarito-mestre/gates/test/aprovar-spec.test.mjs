/**
 * REQ-PNL-8 (E4, GM-12, T8): a aprovação da spec é só do humano, por `/gabarito-mestre:aprovar`.
 * Skill com `disable-model-invocation: true` + hook `UserPromptExpansion` (`aprovar-spec.mjs`, adaptador fino) que chama `aprovarSpec`
 * de `loop.mjs` e grava `spec.aprovada {spec, sha256}`. Mesmo desenho de `liberar-teto.mjs` (liberar-teto.test.mjs): cada caso sobe um
 * repositório git descartável e roda o adaptador real com o stdin do TUI (medido no spike A1, 2.1.318).
 *
 * Um só sha: `shaDaSpec` (exportada de `loop.mjs`, T9 a importa) são os BYTES do arquivo na raiz principal. "Já aprovado" compara só o sha.
 *
 * Limite declarado (Q14): sob o mesmo usuário de SO, `node -e` com `diario.append` ou entrada falsa neste script gravam um evento válido;
 * o núcleo não distingue.
 *
 * MUTAÇÕES PRESCRITAS: task-8-mut.json da entrega.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, symlinkSync, cpSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as diario from '../dist/diario.js';
import { aprovarSpec, shaDaSpec } from '../scripts/loop.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const GATES = join(AQUI, '..');
const PLUGIN = join(GATES, '..');
const HOOK = join(GATES, 'scripts', 'aprovar-spec.mjs');
const LOOP = join(GATES, 'scripts', 'loop.mjs');
const COMANDO = 'gabarito-mestre:aprovar';
const SPEC = 'docs/spec.md';
const SEM_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const PLANO = (extra = {}) => ({ entrega: 'GM-10', spec: SPEC, tasks: [{ id: 'T1', deps: [], arquivos: ['a.ts'] }], ...extra });

let relogio = 0;
const agora = () => (relogio = Math.max(Date.now(), relogio + 1));

/** Repo descartável na branch da entrega, com plano, spec e diário semeado pelo núcleo (nunca à mão). */
function repo({ plano = PLANO(), spec = 'spec v1\n', semear = [], branch = 'enabler/GM-10-teste' } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'aprovar-')));
  git(dir, 'init', '-q', '-b', branch);
  mkdirSync(join(dir, 'docs'), { recursive: true });
  if (spec !== null) writeFileSync(join(dir, SPEC), spec);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'chore: base');
  const entregas = join(dir, '.harness', 'entregas', 'GM-10');
  mkdirSync(entregas, { recursive: true });
  if (plano !== null) writeFileSync(join(entregas, 'plano.json'), typeof plano === 'string' ? plano : JSON.stringify(plano));
  const amb = {
    dir,
    entregas,
    spec: (conteudo, caminho = SPEC) => writeFileSync(join(dir, caminho), conteudo),
    semear(lista, sessao = 'loop') {
      for (const [tipo, dados] of lista) {
        const r = diario.append(entregas, sessao, { ts: new Date(agora()).toISOString(), autor: 't@t', sessao, agente: 'orquestrador', tipo, dados });
        assert.ok(r.ok && r.gravado === 'evento', JSON.stringify(r));
      }
    },
    eventos: () => diario.ler(entregas),
    bytes: () => Object.fromEntries(readdirSync(entregas).sort().map((n) => [n, readFileSync(join(entregas, n), 'utf8')])),
  };
  amb.semear(semear);
  return amb;
}
const aprovadas = (amb) => amb.eventos().filter((e) => e.tipo === 'spec.aprovada');

/** stdin do TUI (spike A1): command_name, command_args e command_source; `agent_id` só quando vem de subagent. */
const stdinTui = (dir, extra = {}) => ({
  session_id: 'S-dono', cwd: dir, hook_event_name: 'UserPromptExpansion', command_name: COMANDO, command_args: '', command_source: 'plugin', ...extra,
});

function hook(entrada, { cwd, script = HOOK } = {}) {
  const input = typeof entrada === 'string' ? entrada : JSON.stringify(entrada);
  const r = spawnSync(process.execPath, [script], { input, encoding: 'utf8', cwd });
  let j = null;
  try { j = r.stdout.trim() === '' ? null : JSON.parse(r.stdout); } catch { /* fica null */ }
  return { rc: r.status, j, out: r.stdout, err: r.stderr };
}
const loop = (dir, ...args) => {
  const r = spawnSync(process.execPath, [LOOP, ...args], { cwd: dir, encoding: 'utf8' });
  let j = null;
  try { j = JSON.parse(r.stdout.trim()); } catch { /* fica null */ }
  return { rc: r.status, j, out: r.stdout, err: r.stderr };
};
function bloqueou(r, causa) {
  assert.equal(r.rc, 0, `hook sai 0: ${r.err}`);
  assert.equal(r.j?.decision, 'block', `block esperado: ${r.out}`);
  assert.match(String(r.j.reason), causa);
}
/** Recusa pelo hook com 0 bytes novos no diário. */
function recusa(amb, entrada, causa) {
  const antes = amb.bytes();
  bloqueou(hook(entrada), causa);
  assert.deepEqual(amb.bytes(), antes, 'recusa não grava nada');
}

test('aprovar-grava-sha-atual: o comando digitado grava 1 spec.aprovada {spec, sha256 dos bytes}, relida; o loop segue válido (costura hook → loop → diário)', () => {
  const amb = repo({ spec: 'spec v1\n' });
  const r = hook(stdinTui(amb.dir));
  assert.equal(r.rc, 0, r.err);
  assert.notEqual(r.j?.decision, 'block', r.out);
  const a = aprovadas(amb);
  assert.equal(a.length, 1);
  assert.deepEqual(a[0].dados, { spec: SPEC, sha256: sha(Buffer.from('spec v1\n')) });
  assert.equal(a[0].sessao, 'S-dono');
  assert.equal(a[0].agente, 'orquestrador');
  assert.equal(r.j.systemMessage, `Spec ${SPEC} aprovada pelo dono (sha256 ${sha(Buffer.from('spec v1\n')).slice(0, 12)}…, entrega GM-10).`);
  // o diário com o evento novo continua válido para o loop: proxima não para por diario_invalido
  const p = loop(amb.dir, 'proxima', '--vivos', '0');
  assert.equal(p.rc, 0, p.err);
  assert.notEqual(p.j?.acao?.motivo, 'diario_invalido');
});

test('aprovar-sha-ja-aprovado-bloqueia: 2ª aprovação do mesmo conteúdo recusa com ja_aprovada e 0 bytes novos', () => {
  const amb = repo();
  assert.notEqual(hook(stdinTui(amb.dir)).j?.decision, 'block');
  recusa(amb, stdinTui(amb.dir), /ja_aprovada/);
  assert.equal(aprovadas(amb).length, 1);
});

test('aprovar-apos-mudanca-grava-de-novo: aprovar A, editar para B, aprovar B grava (2 eventos, shas distintos)', () => {
  const amb = repo({ spec: 'A\n' });
  assert.notEqual(hook(stdinTui(amb.dir)).j?.decision, 'block');
  amb.spec('B\n');
  const r = hook(stdinTui(amb.dir));
  assert.notEqual(r.j?.decision, 'block', r.out);
  assert.deepEqual(aprovadas(amb).map((e) => e.dados.sha256), [sha(Buffer.from('A\n')), sha(Buffer.from('B\n'))]);
});

test('aprovar-reverter-para-sha-antigo-ja-aprovado: A, B, voltar a A ⇒ ja_aprovada (a régua é só o sha, em qualquer posição do diário)', () => {
  const amb = repo({ spec: 'A\n' });
  hook(stdinTui(amb.dir));
  amb.spec('B\n');
  hook(stdinTui(amb.dir));
  amb.spec('A\n');
  recusa(amb, stdinTui(amb.dir), /ja_aprovada/);
  assert.equal(aprovadas(amb).length, 2);
});

test('aprovar-outro-caminho-mesmo-conteudo-ja-aprovado: trocar plano.spec para outro arquivo com os mesmos bytes ⇒ ja_aprovada (não olha `spec`)', () => {
  const amb = repo({ spec: 'mesmo\n' });
  assert.notEqual(hook(stdinTui(amb.dir)).j?.decision, 'block');
  amb.spec('mesmo\n', 'docs/outra.md');
  writeFileSync(join(amb.entregas, 'plano.json'), JSON.stringify(PLANO({ spec: 'docs/outra.md' })));
  recusa(amb, stdinTui(amb.dir), /ja_aprovada/);
});

test('aprovar-sha-dos-bytes: spec com byte 0xff (UTF-8 inválido) ⇒ sha dos bytes, não do texto decodificado', () => {
  const bytes = Buffer.from([0x73, 0x70, 0x65, 0x63, 0xff, 0x0a]);
  const amb = repo({ spec: bytes });
  const r = hook(stdinTui(amb.dir));
  assert.notEqual(r.j?.decision, 'block', r.out);
  const dos_bytes = sha(bytes);
  assert.notEqual(dos_bytes, sha(Buffer.from(bytes.toString('utf8'))), 'o caso distingue bytes de texto');
  assert.equal(aprovadas(amb)[0].dados.sha256, dos_bytes);
});

test('aprovar-forma-antiga-maiuscula-nao-conta: spec.aprovada antigo com sha em maiúsculas ou com 63 caracteres não é aprovação (forma inválida)', () => {
  // sha certo mas `spec` ausente ou não texto também é forma inválida: não conta (o evento só vale inteiro)
  const casos = [(s) => ({ spec: SPEC, sha256: s.toUpperCase() }), (s) => ({ spec: SPEC, sha256: s.slice(0, 63) }), (s) => ({ sha256: s }), (s) => ({ spec: 42, sha256: s })];
  for (const dadosRuins of casos) {
    const amb = repo({ spec: 'v\n' });
    const s = sha(Buffer.from('v\n'));
    const linha = { seq: 1, ts: new Date(agora()).toISOString(), autor: 't@t', sessao: 'velha', agente: 'orquestrador', tipo: 'spec.aprovada', dados: dadosRuins(s), hash_anterior: null };
    writeFileSync(join(amb.entregas, 'events.velha.jsonl'), `${JSON.stringify(linha)}\n`);
    const r = hook(stdinTui(amb.dir));
    assert.notEqual(r.j?.decision, 'block', r.out);
    assert.equal(aprovadas(amb).filter((e) => e.sessao === 'S-dono' && e.dados.sha256 === s).length, 1, `gravou: o antigo não contou ${JSON.stringify(dadosRuins(s))}`);
  }
});

test('aprovar-subagent-bloqueia: agent_id presente, com qualquer valor (inclusive null), bloqueia e nada é gravado', () => {
  for (const agent_id of ['a1', null, '', 0]) {
    const amb = repo();
    recusa(amb, stdinTui(amb.dir, { agent_id }), /subagent/);
    assert.equal(aprovadas(amb).length, 0);
  }
});

test('aprovar-plano-sem-spec: plano.spec ausente, não texto ou vazio ⇒ sem_spec', () => {
  for (const spec of [undefined, 42, '', null, ['a']]) {
    const plano = { entrega: 'GM-10', tasks: [{ id: 'T1', deps: [], arquivos: ['a.ts'] }] };
    if (spec !== undefined) plano.spec = spec;
    const amb = repo({ plano });
    const antes = amb.bytes();
    const r = hook(stdinTui(amb.dir));
    // plano_invalido é a recusa do próprio plano (forma); sem_spec a do plano válido sem spec: as duas bloqueiam e não gravam
    assert.equal(r.j?.decision, 'block', `${JSON.stringify(spec)}: ${r.out}`);
    assert.match(String(r.j.reason), /sem_spec|plano_invalido/, JSON.stringify(spec));
    assert.deepEqual(amb.bytes(), antes);
  }
  const amb = repo({ plano: { entrega: 'GM-10', tasks: [{ id: 'T1', deps: [], arquivos: ['a.ts'] }] } });
  recusa(amb, stdinTui(amb.dir), /sem_spec/);
});

test('aprovar-arquivo-ausente: a spec do plano não existe ⇒ spec_ausente (e não spec_ilegivel)', () => {
  const amb = repo({ spec: null });
  recusa(amb, stdinTui(amb.dir), /spec_ausente/);
});

test('aprovar-spec-fora-da-raiz: `..`, absoluto fora e symlink dentro da raiz apontando para fora ⇒ spec_fora_da_raiz', () => {
  const fora = realpathSync(mkdtempSync(join(tmpdir(), 'aprovar-fora-')));
  writeFileSync(join(fora, 'fora.md'), 'x\n');
  for (const spec of ['../fora.md', join(fora, 'fora.md')]) {
    const amb = repo({ plano: PLANO({ spec }) });
    recusa(amb, stdinTui(amb.dir), /spec_fora_da_raiz/);
  }
  const amb = repo({ spec: null });
  symlinkSync(join(fora, 'fora.md'), join(amb.dir, SPEC));
  recusa(amb, stdinTui(amb.dir), /spec_fora_da_raiz/);
  assert.equal(shaDaSpec(amb.dir, PLANO()).erro, 'spec_fora_da_raiz');
});

test('aprovar-spec-diretorio-ilegivel: spec = diretório ⇒ spec_ilegivel; EACCES ⇒ spec_ilegivel', () => {
  const amb = repo({ spec: null });
  mkdirSync(join(amb.dir, SPEC));
  recusa(amb, stdinTui(amb.dir), /spec_ilegivel/);
  if (!SEM_ROOT) {
    const a2 = repo({ spec: 'x\n' });
    chmodSync(join(a2.dir, SPEC), 0o000);
    recusa(a2, stdinTui(a2.dir), /spec_ilegivel/);
    chmodSync(join(a2.dir, SPEC), 0o644);
  }
});

test('aprovar-spec-vazia: arquivo de 0 bytes ⇒ spec_vazia', () => {
  const amb = repo({ spec: '' });
  recusa(amb, stdinTui(amb.dir), /spec_vazia/);
});

test('aprovar-stdin-ausente-x-corrompido: vazio, não JSON e não objeto bloqueiam com motivos distintos; nada gravado', () => {
  const amb = repo();
  const vazio = hook('', { cwd: amb.dir });
  const lixo = hook('não é json', { cwd: amb.dir });
  const naoObjeto = hook('[]', { cwd: amb.dir });
  const nulo = hook('null', { cwd: amb.dir });
  bloqueou(vazio, /stdin do hook ausente/);
  bloqueou(hook('   \n', { cwd: amb.dir }), /stdin do hook ausente/);
  bloqueou(lixo, /stdin do hook não é JSON/);
  bloqueou(naoObjeto, /não é um objeto JSON/);
  bloqueou(nulo, /não é um objeto JSON/);
  assert.equal(new Set([vazio.j.reason, lixo.j.reason, naoObjeto.j.reason]).size, 3);
  assert.equal(aprovadas(amb).length, 0);
});

test('aprovar-outro-comando-silencio: outro command_name sai 0 sem stdout e sem gravar', () => {
  const amb = repo();
  for (const command_name of ['gabarito-mestre:aprovarx', 'gabarito-mestre:emenda', 'gabarito-mestre:liberar', '', 'aprovar']) {
    const r = hook(stdinTui(amb.dir, { command_name }));
    assert.equal(r.rc, 0);
    assert.equal(r.out, '', command_name);
  }
  assert.equal(hook({ cwd: amb.dir }).out, '', 'sem command_name');
  assert.equal(aprovadas(amb).length, 0);
});

test('aprovar-argumento-bloqueia: command_args não vazio bloqueia (inclusive o 1º que pareceria um sha); nada gravado', () => {
  for (const command_args of ['sim', 'T1', ' x ', 0, ['x'], { a: 1 }, 'a'.repeat(64)]) {
    const amb = repo();
    recusa(amb, stdinTui(amb.dir, { command_args }), /não leva argumento/);
    assert.equal(aprovadas(amb).length, 0);
  }
});

test('aprovar-sem-argumento-ou-espacos-segue: command_args ausente, null, vazio ou só espaços aprova', () => {
  const variantes = [{ command_args: '' }, { command_args: '   ' }, { command_args: null }, { command_args: undefined }, { command_args: '\t\n' }];
  for (const v of variantes) {
    const amb = repo();
    const r = hook(stdinTui(amb.dir, v));
    assert.notEqual(r.j?.decision, 'block', `${JSON.stringify(v)}: ${r.out}`);
    assert.equal(aprovadas(amb).length, 1, JSON.stringify(v));
  }
});

test('aprovar-sessao: session_id fora da forma grava como `dono`; cwd ausente usa o cwd do processo', () => {
  const amb = repo();
  const r = hook(stdinTui(amb.dir, { session_id: 'sessão inválida/..', cwd: undefined }), { cwd: amb.dir });
  assert.notEqual(r.j?.decision, 'block', r.out);
  assert.equal(aprovadas(amb)[0].sessao, 'dono');
});

test('aprovar-fora-de-repo-plano-ausente-plano-invalido: cada um bloqueia com a causa própria', () => {
  const fora = realpathSync(mkdtempSync(join(tmpdir(), 'aprovar-nrepo-')));
  bloqueou(hook(stdinTui(fora)), /fora_de_repo/);
  const sem = repo({ plano: null });
  recusa(sem, stdinTui(sem.dir), /plano_ausente/);
  const ruim = repo({ plano: '{' });
  recusa(ruim, stdinTui(ruim.dir), /plano_invalido/);
});

test('aprovar-de-dentro-da-worktree-usa-principal: grava no diário da raiz principal, com o sha da spec da principal', () => {
  const amb = repo({ spec: 'principal\n', branch: 'main' });
  const wt = join(amb.dir, '.harness', 'worktrees', 'T1');
  const r0 = git(amb.dir, 'worktree', 'add', '-q', '-b', 'wt/GM-10-T1', wt);
  assert.equal(r0.status, 0, r0.stderr);
  writeFileSync(join(wt, SPEC), 'da worktree\n');
  const r = hook(stdinTui(realpathSync(wt)));
  assert.notEqual(r.j?.decision, 'block', r.out);
  const a = aprovadas(amb);
  assert.equal(a.length, 1, 'no diário da principal');
  assert.equal(a[0].dados.sha256, sha(Buffer.from('principal\n')));
  assert.notEqual(a[0].dados.sha256, sha(Buffer.from('da worktree\n')));
  assert.equal(existsSync(join(wt, '.harness', 'entregas')), false, 'a worktree não ganhou diário');
});

test('aprovar-diario-invalido-bloqueia: task.iniciada de task fora do plano ⇒ diario_invalido, 0 bytes novos', () => {
  const amb = repo({ semear: [['task.iniciada', { task: 'T9', papel: 'implementador' }]] });
  recusa(amb, stdinTui(amb.dir), /diario_invalido/);
  const lixo = repo();
  writeFileSync(join(lixo.entregas, 'events.x.jsonl'), 'não é json\n');
  recusa(lixo, stdinTui(lixo.dir), /diario_ilegivel/);
});

test('aprovar-spec-mudou-no-antes: o arquivo mudou entre o hash e o append ⇒ spec_mudou, nada gravado', () => {
  const amb = repo({ spec: 'A\n' });
  const antes = amb.bytes();
  const r = aprovarSpec(amb.dir, 'S-dono', { antes: () => amb.spec('B\n') });
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'spec_mudou');
  assert.deepEqual(amb.bytes(), antes);
  // sem a troca, o mesmo arquivo aprova
  assert.equal(aprovarSpec(amb.dir, 'S-dono').ok, true);
});

test('aprovar-antes-que-lanca-propaga-e-nao-grava: o que opcoes.antes lançar vira a recusa, sem evento', () => {
  const amb = repo();
  const antes = amb.bytes();
  const r = aprovarSpec(amb.dir, 'S-dono', { antes: () => { throw new Error('sombra'); } });
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /sombra/);
  assert.deepEqual(amb.bytes(), antes);
});

test('aprovar-sem-efeito-reler: evento gravado que o diário relido não mostra ⇒ aprovacao_sem_efeito', () => {
  const amb = repo();
  const r = aprovarSpec(amb.dir, 'S-dono', {
    depois: () => { for (const n of readdirSync(amb.entregas)) if (n.startsWith('events.')) writeFileSync(join(amb.entregas, n), ''); },
  });
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'aprovacao_sem_efeito');
});

test('aprovar-sessao-invalida: aprovarSpec com sessão fora da forma ⇒ argumento_invalido, nunca lança', () => {
  const amb = repo();
  for (const s of ['', 'a/b', 'x'.repeat(129), 42, null, undefined]) {
    const r = aprovarSpec(amb.dir, s);
    assert.equal(r.ok, false, String(s));
    assert.equal(r.erro, 'argumento_invalido', String(s));
  }
  assert.deepEqual(aprovadas(amb), []);
});

test('aprovar-ok-devolve-spec-sha-entrega: aprovarSpec ok traz plano.spec como está (não o absoluto), sha256 e entrega', () => {
  const amb = repo({ spec: 'v\n' });
  const r = aprovarSpec(amb.dir, 'S-dono');
  assert.deepEqual(r, { ok: true, spec: SPEC, sha256: sha(Buffer.from('v\n')), entrega: 'GM-10' });
});

test('sha-da-spec: ok traz spec e sha256 dos bytes; cada recusa tem o seu erro; nunca lança', () => {
  const amb = repo({ spec: 'abc\n' });
  assert.deepEqual(shaDaSpec(amb.dir, PLANO()), { ok: true, spec: SPEC, sha256: sha(Buffer.from('abc\n')) });
  const erro = (plano, raiz = amb.dir) => shaDaSpec(raiz, plano).erro;
  assert.equal(erro({ tasks: [] }), 'sem_spec');
  assert.equal(erro(PLANO({ spec: '' })), 'sem_spec');
  assert.equal(erro(PLANO({ spec: 7 })), 'sem_spec');
  assert.equal(erro(null), 'sem_spec');
  assert.equal(erro(undefined), 'sem_spec');
  assert.equal(erro(PLANO({ spec: '../x.md' })), 'spec_fora_da_raiz');
  assert.equal(erro(PLANO({ spec: 'docs/nao-existe.md' })), 'spec_ausente');
  assert.equal(erro(PLANO({ spec: 'docs' })), 'spec_ilegivel');
  assert.equal(erro(PLANO(), join(amb.dir, 'nao-existe')), 'spec_ausente');
  for (const plano of [{ tasks: [] }, PLANO({ spec: '../x.md' }), PLANO({ spec: 'docs/nao-existe.md' })]) {
    const r = shaDaSpec(amb.dir, plano);
    assert.equal(r.ok, false);
    assert.equal(typeof r.mensagem, 'string');
    assert.notEqual(r.mensagem, '');
  }
});

test('sha-da-spec-igual-ao-do-painel: o sha gravado pelo hook é o de shaDaSpec (a costura de T9 importa esta função)', () => {
  const amb = repo({ spec: 'costura\n' });
  hook(stdinTui(amb.dir));
  assert.equal(aprovadas(amb)[0].dados.sha256, shaDaSpec(amb.dir, PLANO()).sha256);
});

test('aprovar-dist-ausente-bloqueia: sem dist/ o hook falha fechado (block "o hook falhou"), nunca silêncio nem sucesso', () => {
  const raiz = realpathSync(mkdtempSync(join(tmpdir(), 'aprovar-semdist-')));
  mkdirSync(join(raiz, 'gates'), { recursive: true });
  cpSync(join(GATES, 'scripts'), join(raiz, 'gates', 'scripts'), { recursive: true });
  cpSync(join(GATES, 'lib'), join(raiz, 'gates', 'lib'), { recursive: true });
  const amb = repo();
  const r = hook(stdinTui(amb.dir), { script: join(raiz, 'gates', 'scripts', 'aprovar-spec.mjs') });
  bloqueou(r, /o hook falhou/);
  assert.equal(aprovadas(amb).length, 0);
});

test('hooks-json-matcher-real: o matcher casa com gabarito-mestre:aprovar e com mais nada; onFailure block, timeout 10, comando existe', () => {
  const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8'));
  const g = hooks.hooks.UserPromptExpansion.find((x) => x.matcher.includes('aprovar'));
  const re = new RegExp(g.matcher);
  assert.equal(re.test('gabarito-mestre:aprovar'), true);
  for (const n of ['gabarito-mestre:aprovar2', 'gabarito-mestre:emenda', 'gabarito-mestre:liberar', 'gabarito-mestre:aprovar ']) assert.equal(re.test(n), false, n);
  assert.equal(g.hooks[0].onFailure, 'block');
  assert.equal(g.hooks[0].timeout, 10);
  assert.equal(g.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/aprovar-spec.mjs"');
  assert.equal(readFileSync(HOOK, 'utf8').length > 0, true);
});

test('skill-aprovar-frontmatter: só do dono, sem argumento, sem citar painel.mjs, não afirma que aprovou, manda seguir o loop', () => {
  const t = readFileSync(join(PLUGIN, 'skills', 'aprovar', 'SKILL.md'), 'utf8');
  const cab = /^---\n([\s\S]*?)\n---/.exec(t)?.[1] ?? '';
  assert.match(cab, /^name: aprovar$/m);
  assert.match(cab, /^disable-model-invocation: true$/m);
  assert.doesNotMatch(cab, /argument-hint/);
  assert.match(cab, /^allowed-tools: Read, Bash\(node:\*\)$/m);
  assert.match(t, /\/gabarito-mestre:aprovar/);
  assert.match(t, /Não afirme que (aprovou|gravou)/);
  assert.match(t, /gabarito-loop/);
  assert.match(t, /Não grave nem edite o diário/);
  assert.doesNotMatch(t, /painel\.mjs/);
});

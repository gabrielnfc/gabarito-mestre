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
import { aprovarSpec, lerSpecs, shaDaSpec } from '../scripts/loop.mjs';

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
  // T15 (REQ-TRI-1): sem plano.json a spec vem de docs/superpowers/specs; sem nenhuma da entrega ⇒ spec_ausente, nada gravado
  const sem = repo({ plano: null });
  recusa(sem, stdinTui(sem.dir), /spec_ausente/);
  const ruim = repo({ plano: '{' });
  recusa(ruim, stdinTui(ruim.dir), /plano_invalido/);
});

test('aprovar-de-dentro-da-worktree-spec-da-worktree: grava no diário da raiz principal, com o sha da spec da WORKTREE (T38, DP-3 aj. 4)', () => {
  const amb = repo({ spec: 'principal\n', branch: 'main' });
  const wt = join(amb.dir, '.harness', 'worktrees', 'T1');
  const r0 = git(amb.dir, 'worktree', 'add', '-q', '-b', 'wt/GM-10-T1', wt);
  assert.equal(r0.status, 0, r0.stderr);
  writeFileSync(join(wt, SPEC), 'da worktree\n');
  const r = hook(stdinTui(realpathSync(wt)));
  assert.notEqual(r.j?.decision, 'block', r.out);
  const a = aprovadas(amb);
  assert.equal(a.length, 1, 'no diário da principal');
  assert.equal(a[0].dados.sha256, sha(Buffer.from('da worktree\n')));
  assert.notEqual(a[0].dados.sha256, sha(Buffer.from('principal\n')));
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

// ─────────────────────────────────────────────────────────────── T15 (REQ-TRI-1): aprovar antes do plano

const DIR_SPECS = 'docs/superpowers/specs';
/** Spec em `docs/superpowers/specs/<nome>` com cabeçalho `PBI: <pbi>` (null = sem cabeçalho). */
function specPbi(amb, nome, pbi, corpo = '## Uma\n\n## Duas\n') {
  mkdirSync(join(amb.dir, DIR_SPECS), { recursive: true });
  const texto = `# Título ${nome}\n\n${pbi === null ? '' : `PBI: ${pbi}\n`}\n${corpo}`;
  writeFileSync(join(amb.dir, DIR_SPECS, nome), texto);
  return { caminho: `${DIR_SPECS}/${nome}`, bytes: Buffer.from(texto) };
}

test('aprovar-sem-plano-spec-unica-grava: sem plano.json, a única spec com PBI da entrega é aprovada (hook real → loop → diário)', () => {
  const amb = repo({ plano: null, spec: null });
  const alvo = specPbi(amb, 'a.md', 'GM-10');
  specPbi(amb, 'b.md', 'GM-11'); // outra entrega não conta
  specPbi(amb, 'c.md', null); // sem cabeçalho não conta
  const r = hook(stdinTui(amb.dir));
  assert.equal(r.rc, 0, r.err);
  assert.notEqual(r.j?.decision, 'block', r.out);
  const a = aprovadas(amb);
  assert.equal(a.length, 1);
  assert.deepEqual(a[0].dados, { spec: alvo.caminho, sha256: sha(alvo.bytes) });
  assert.equal(a[0].sessao, 'S-dono');
  assert.equal(r.j.systemMessage, `Spec ${alvo.caminho} aprovada pelo dono (sha256 ${sha(alvo.bytes).slice(0, 12)}…, entrega GM-10).`);
  assert.equal(existsSync(join(amb.entregas, 'plano.json')), false, 'aprovar não cria plano');
  // 2ª vez com o mesmo sha: ja_aprovada, nada gravado (a régua de sempre vale sem plano)
  recusa(amb, stdinTui(amb.dir), /ja_aprovada/);
  // a costura pela função: o mesmo resultado sem o hook, depois de editar a spec
  writeFileSync(join(amb.dir, alvo.caminho), 'mudou\nPBI: GM-10\n');
  assert.deepEqual(aprovarSpec(amb.dir, 'S-dono'), { ok: true, spec: alvo.caminho, sha256: sha(Buffer.from('mudou\nPBI: GM-10\n')), entrega: 'GM-10' });
});

test('aprovar-sem-plano-duas-specs-recusa: 2 specs da entrega ⇒ spec_ambigua; 0 ⇒ spec_ausente; nada gravado em nenhum dos dois', () => {
  const duas = repo({ plano: null, spec: null });
  specPbi(duas, 'a.md', 'GM-10');
  specPbi(duas, 'b.md', 'GM-10');
  recusa(duas, stdinTui(duas.dir), /spec_ambigua/);
  assert.equal(aprovarSpec(duas.dir, 'S-dono').erro, 'spec_ambigua');
  assert.equal(aprovadas(duas).length, 0);
  assert.equal(existsSync(join(duas.entregas, 'plano.json')), false);
  const nenhuma = repo({ plano: null, spec: null });
  specPbi(nenhuma, 'b.md', 'GM-11');
  recusa(nenhuma, stdinTui(nenhuma.dir), /spec_ausente/);
  assert.equal(aprovarSpec(nenhuma.dir, 'S-dono').erro, 'spec_ausente');
  assert.equal(aprovadas(nenhuma).length, 0);
  // diretório de specs ausente também é 0 specs (não falha de leitura)
  const semDir = repo({ plano: null, spec: null });
  assert.equal(aprovarSpec(semDir.dir, 'S-dono').erro, 'spec_ausente');
});

test('aprovar-com-plano-inalterado: com plano.json vale plano.spec, mesmo com 2 specs da entrega em docs/superpowers/specs; plano.json intocado', () => {
  const amb = repo({ spec: 'do plano\n' });
  specPbi(amb, 'a.md', 'GM-10');
  specPbi(amb, 'b.md', 'GM-10');
  const planoAntes = readFileSync(join(amb.entregas, 'plano.json'), 'utf8');
  const r = hook(stdinTui(amb.dir));
  assert.notEqual(r.j?.decision, 'block', r.out);
  assert.deepEqual(aprovadas(amb).map((e) => e.dados), [{ spec: SPEC, sha256: sha(Buffer.from('do plano\n')) }]);
  assert.equal(readFileSync(join(amb.entregas, 'plano.json'), 'utf8'), planoAntes);
  // plano presente e inválido não cai no caminho sem plano: segue plano_invalido
  const ruim = repo({ plano: '{' });
  specPbi(ruim, 'a.md', 'GM-10');
  recusa(ruim, stdinTui(ruim.dir), /plano_invalido/);
});

test('ler-specs-ausente-x-ilegivel: diretório ausente ⇒ []; ilegível ⇒ lança specs_ilegiveis; cada campo vem do arquivo', () => {
  const amb = repo({ plano: null, spec: null });
  assert.deepEqual(lerSpecs(amb.dir), []);
  const a = specPbi(amb, 'a.md', 'GM-10', '## Uma\n\n## Duas\n\n## Três\n');
  specPbi(amb, 'z.md', null, '');
  writeFileSync(join(amb.dir, DIR_SPECS, 'nao-md.txt'), 'PBI: GM-10\n');
  mkdirSync(join(amb.dir, DIR_SPECS, 'pasta.md'));
  // PBI só nas 15 primeiras linhas
  writeFileSync(join(amb.dir, DIR_SPECS, 'tarde.md'), `# Tarde\n${'x\n'.repeat(15)}PBI: GM-10\n`);
  assert.deepEqual(lerSpecs(amb.dir), [
    { caminho: a.caminho, pbi: 'GM-10', sha256: sha(a.bytes), secoes: 3, titulo: 'Título a.md' },
    { caminho: `${DIR_SPECS}/tarde.md`, pbi: null, sha256: sha(Buffer.from(`# Tarde\n${'x\n'.repeat(15)}PBI: GM-10\n`)), secoes: 0, titulo: 'Tarde' },
    { caminho: `${DIR_SPECS}/z.md`, pbi: null, sha256: sha(Buffer.from('# Título z.md\n\n\n')), secoes: 0, titulo: 'Título z.md' },
  ]);
  if (!SEM_ROOT) {
    chmodSync(join(amb.dir, DIR_SPECS), 0o000);
    try {
      assert.throws(() => lerSpecs(amb.dir), (e) => e.erro === 'specs_ilegiveis');
      // e pela borda: ilegível não vira "sem spec" (spec_ausente), nada gravado
      const r = aprovarSpec(amb.dir, 'S-dono');
      assert.equal(r.erro, 'specs_ilegiveis');
      assert.equal(aprovadas(amb).length, 0);
    } finally {
      chmodSync(join(amb.dir, DIR_SPECS), 0o755);
    }
  }
});

// ─────────────────────────────────────────────────────────────── T15 r1: PBI só do cabeçalho (DP-3 aj. 1) e garantias sem plano (aj. 2)

/** As specs reais do repo, versionadas: as 6 com `PBI:` no meio da linha 3, entre `·`, e 3 sem PBI no cabeçalho; a da GM-14 cita `PBI: <ID>` também no corpo, que não conta. */
const SPECS_REAIS = join(PLUGIN, '..', '..', DIR_SPECS);
const REAIS = {
  '2026-10-31-e1-fundacao-design.md': 'GM-9',
  '2026-10-31-visao-2.0-design.md': null,
  '2026-11-03-e2-loop-pouso-design.md': 'GM-10',
  '2026-11-09-e3-sombra-emendas-entrega-design.md': 'GM-11',
  '2026-11-09-e4-painel-design.md': 'GM-12',
  '2026-11-10-e5-fluxo-gabarito-design.md': 'GM-13',
  '2026-11-11-gm14-clareza-anexos.md': null,
  '2026-11-11-gm14-clareza-design.md': 'GM-14',
  '2026-11-11-gm14-decisoes-dono.md': null,
};

test('ler-specs-pbi-so-do-cabecalho: as 6 specs reais dão o PBI do meio da linha 3; o corpo nunca conta; ID fora do idPadrao ancorado não conta', () => {
  const amb = repo({ plano: null, spec: null });
  mkdirSync(join(amb.dir, DIR_SPECS), { recursive: true });
  for (const nome of Object.keys(REAIS)) cpSync(join(SPECS_REAIS, nome), join(amb.dir, DIR_SPECS, nome));
  const porNome = (lista) => Object.fromEntries(lista.map((s) => [s.caminho.slice(DIR_SPECS.length + 1), s.pbi]));
  assert.deepEqual(porNome(lerSpecs(amb.dir)), REAIS);
  assert.equal(Object.values(REAIS).filter((p) => p !== null).length, 6);
  // casos sintéticos: cada um com o valor esperado
  const casos = {
    'corpo.md': ['# C\n\n## Notas\nVer PBI: GM-10\n', null], // depois do 1º `## ` nunca conta
    'meio.md': ['# M\n\nIniciativa: x · PBI: GM-10 · Data: hoje\n\n## A\n', 'GM-10'],
    'minusc.md': ['# m\nPBI: gm-10\n', null], // não casa o idPadrao padrão
    'cauda.md': ['# c\nPBI: GM-10x\n', null], // `GM-10x` não é `GM-10`
    'colado.md': ['# c\nXPBI: GM-10\n', null], // token precisa de início, espaço ou `·` antes
    'primeiro.md': ['# p\nPBI: GM-11 · PBI: GM-10\n', 'GM-11'], // o 1º token decide
    'ruim-primeiro.md': ['# r\nPBI: nada\nPBI: GM-10\n', null], // o 1º `PBI:` do cabeçalho decide, mesmo fora do padrão
  };
  for (const [nome, [texto]] of Object.entries(casos)) writeFileSync(join(amb.dir, DIR_SPECS, nome), texto);
  const lidos = porNome(lerSpecs(amb.dir));
  for (const [nome, [, esperado]] of Object.entries(casos)) assert.equal(lidos[nome], esperado, nome);
  // idPadrao explícito: `GM-10` não casa `PROJ-\d+`; `PROJ-3` casa
  writeFileSync(join(amb.dir, DIR_SPECS, 'proj.md'), '# P\nPBI: PROJ-3\n');
  const outro = porNome(lerSpecs(amb.dir, 'PROJ-\\d+'));
  assert.equal(outro['meio.md'], null);
  assert.equal(outro['proj.md'], 'PROJ-3');
  assert.equal(outro['2026-11-11-gm14-clareza-design.md'], null);
});

test('aprovar-sem-plano-corpo-nao-ambigua: cabeçalho de a.md + "## Notas / Ver PBI: GM-10" em c.md ⇒ a.md aprovada, nunca spec_ambigua', () => {
  const amb = repo({ plano: null, spec: null });
  const alvo = specPbi(amb, 'a.md', 'GM-10');
  specPbi(amb, 'c.md', null, '## Notas\nVer PBI: GM-10\n');
  assert.deepEqual(aprovarSpec(amb.dir, 'S-dono'), { ok: true, spec: alvo.caminho, sha256: sha(alvo.bytes), entrega: 'GM-10' });
  assert.equal(aprovadas(amb).length, 1);
});

test('aprovar-sem-plano-spec-mudou: sem plano.json, a spec mudou entre o hash e o append ⇒ spec_mudou, 0 bytes novos', () => {
  const amb = repo({ plano: null, spec: null });
  const alvo = specPbi(amb, 'a.md', 'GM-10');
  const antes = amb.bytes();
  const r = aprovarSpec(amb.dir, 'S-dono', { antes: () => writeFileSync(join(amb.dir, alvo.caminho), 'outra\nPBI: GM-10\n') });
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'spec_mudou');
  assert.deepEqual(amb.bytes(), antes);
  assert.equal(existsSync(join(amb.entregas, 'plano.json')), false);
  // sem a troca, a mesma spec aprova
  assert.equal(aprovarSpec(amb.dir, 'S-dono').ok, true);
});

test('aprovar-sem-plano-sem-efeito: sem plano.json, evento gravado que o diário relido não mostra ⇒ aprovacao_sem_efeito', () => {
  const amb = repo({ plano: null, spec: null });
  specPbi(amb, 'a.md', 'GM-10');
  const r = aprovarSpec(amb.dir, 'S-dono', {
    depois: () => { for (const n of readdirSync(amb.entregas)) if (n.startsWith('events.')) writeFileSync(join(amb.entregas, n), ''); },
  });
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'aprovacao_sem_efeito');
});

test('spec-na-worktree-da-sessao-sem-plano: sem plano.json, a spec só na worktree REAL é aprovada; o medir da sessão dá o mesmo sha; garantias intactas', async () => {
  const { medir } = await import('../scripts/painel-medir.mjs');
  const amb = repo({ plano: null, spec: null, branch: 'main' });
  const wtCru = join(amb.dir, '.harness', 'worktrees', 'S1');
  const r0 = git(amb.dir, 'worktree', 'add', '-q', '-b', 'wt/GM-10-S1', wtCru);
  assert.equal(r0.status, 0, r0.stderr);
  const wt = realpathSync(wtCru);
  // a spec da entrega SÓ na worktree; a principal tem outra spec da mesma entrega (lê-la daria outro sha ou spec_ambigua)
  const texto = '# GM-10\n\nIniciativa: X · PBI: GM-10 (Enabler) · Data: hoje\n\n## Uma\n';
  const caminho = `${DIR_SPECS}/gm10.md`;
  mkdirSync(join(wt, DIR_SPECS), { recursive: true });
  writeFileSync(join(wt, caminho), texto);
  specPbi(amb, 'outra.md', 'GM-10');
  // hook real de dentro da worktree
  const r = hook(stdinTui(wt));
  assert.equal(r.rc, 0, r.err);
  assert.notEqual(r.j?.decision, 'block', r.out);
  const a = aprovadas(amb);
  assert.deepEqual(a.map((e) => e.dados), [{ spec: caminho, sha256: sha(Buffer.from(texto)) }], 'no diário da principal, sha da worktree');
  assert.equal(existsSync(join(wt, '.harness', 'entregas')), false, 'a worktree não ganhou diário');
  assert.equal(existsSync(join(amb.entregas, 'plano.json')), false, 'aprovar não cria plano');
  // lerSpecs do checkout da sessão: o mesmo sha
  assert.deepEqual(lerSpecs(wt).filter((s) => s.pbi === 'GM-10').map((s) => [s.caminho, s.sha256]), [[caminho, sha(Buffer.from(texto))]]);
  // medir (painel-medir) da mesma sessão: o mesmo caminho e sha
  const rodar = (cmd, args, o) => (cmd === 'git' ? spawnSync('git', args, { cwd: o.cwd, encoding: 'utf8' }) : { status: 1, stdout: '', stderr: 'sem gh' });
  medir(wt, { rodar, agentes: { session_id: 'S-medir', agentes: [] }, agora: () => Date.parse('2026-11-12T20:00:00Z') });
  const medidos = amb.eventos().filter((e) => e.tipo === 'fato.medido' && e.dados.chave === 'spec').map((e) => [e.dados.valor.caminho, e.dados.valor.sha256]);
  assert.deepEqual(medidos, [[caminho, sha(Buffer.from(texto))]]);
  // garantias sem plano (DP-3 aj. 2) seguem do checkout da sessão: ja_aprovada, spec_mudou, aprovacao_sem_efeito
  const bytesAntes = amb.bytes();
  assert.equal(aprovarSpec(wt, 'S-dono').erro, 'ja_aprovada');
  writeFileSync(join(wt, caminho), `${texto}v2\n`);
  assert.equal(aprovarSpec(wt, 'S-dono', { antes: () => writeFileSync(join(wt, caminho), `${texto}v3\n`) }).erro, 'spec_mudou');
  assert.deepEqual(amb.bytes(), bytesAntes, 'recusas não gravam');
  const semEfeito = aprovarSpec(wt, 'S-dono', {
    depois: () => { for (const n of readdirSync(amb.entregas)) if (n.startsWith('events.')) writeFileSync(join(amb.entregas, n), ''); },
  });
  assert.equal(semEfeito.erro, 'aprovacao_sem_efeito');
});

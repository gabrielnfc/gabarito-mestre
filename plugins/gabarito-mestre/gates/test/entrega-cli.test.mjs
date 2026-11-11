/**
 * REQ-ENT-1/ENT-2 pela borda: `entrega.mjs` (decidir, executar). Nada de deploy real: cada caso monta um repositório descartável
 * (`mkdtemp`, com ESPAÇO no caminho) com `origin` bare local e scripts falsos que só gravam marcadores sob o mesmo diretório.
 * O relógio entra por `agoraMs` (em processo) ou não entra (CLI: `continua`); falha de `append` entra por `opts.append`.
 *
 * MUTAÇÕES PRESCRITAS: task-8-mut.json da entrega.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, realpathSync, appendFileSync, renameSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as diario from '../dist/diario.js';
import { decidirEntrega } from '../dist/entrega.js';
import { decidirAgora, decisaoDe, executarEntrega, prepararLeitura, rcDe } from '../scripts/entrega.mjs';
import { fecharPendenciasNoDiario } from './_adaptador-helpers.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(AQUI, '..', 'scripts', 'entrega.mjs');
const ENTREGA = 'GM-10';
const SENTINELA = 'SENTINELA_ARGV_7c1e';
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const token = () => `ghp_${'A'.repeat(36)}`;

const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const SCRIPTS_PADRAO = {
  deploy: 'echo ola-deploy\ntouch "$M/deploy"',
  smoke: 'echo ola-smoke\ntouch "$M/smoke"',
  rollback: 'echo ola-rollback\ntouch "$M/rollback"',
};
const PLANO_PADRAO = ['T1', 'T2'];

/**
 * Repositório descartável. `origem` (objeto, texto ou `false` = arquivo ausente) é o `harness.config.json` publicado em origin/HEAD;
 * `semOrigin` não cria remoto; `local` (objeto) é commitado depois, só no local. `integradas`: tasks com a esteira completa; `homolog`:
 * `true`/`false`/`null` (sem resultado).
 */
function montar({
  politica = 'continua', autonomia = true, semAutonomia = false, janela, origem, semOrigin = false, local, scripts = {}, timeouts = {}, extraArgv = [], deployArgv, comandos = ['deploy', 'smoke', 'rollback'],
  tasks = PLANO_PADRAO, integradas = tasks, homolog = true, planoExtra = {}, registro = true,
} = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'entrega cli ')));
  const repo = join(base, 'repo com espaço');
  const marcas = join(base, 'marcas');
  mkdirSync(repo);
  mkdirSync(marcas);
  g(repo, 'init', '-q', '-b', 'main');
  g(repo, 'config', 'user.email', 't@t.test');
  g(repo, 'config', 'user.name', 't');
  mkdirSync(join(repo, 'fake'));
  const corpos = { ...SCRIPTS_PADRAO, ...scripts };
  for (const nome of ['deploy', 'smoke', 'rollback']) {
    writeFileSync(join(repo, 'fake', `${nome}.sh`), `M='${marcas}'\necho "$0|$PWD" >> "$M/exec.log"\n${corpos[nome]}\n`);
  }
  const cmds = {};
  for (const nome of comandos) {
    const argv = nome === 'deploy' && deployArgv ? deployArgv(base) : ['bash', join(repo, 'fake', `${nome}.sh`), ...(nome === 'deploy' ? extraArgv : [])];
    cmds[nome] = { argv, timeout_s: timeouts[nome] ?? 20 };
  }
  const entrega = { politica, ...(semAutonomia ? {} : { autonomia }), base: 'main', comandos: cmds, ...(janela ? { janela } : {}) };
  const cfgOrigem = origem === undefined ? { entrega } : origem;
  if (cfgOrigem !== false) writeFileSync(join(repo, 'harness.config.json'), typeof cfgOrigem === 'string' ? cfgOrigem : JSON.stringify(cfgOrigem));
  writeFileSync(join(repo, 'README.md'), 'x\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-q', '-m', 'inicio');
  if (!semOrigin) {
    const bare = join(base, 'origin.git');
    mkdirSync(bare);
    g(bare, 'init', '-q', '--bare', '-b', 'main');
    g(repo, 'remote', 'add', 'origin', bare);
    g(repo, 'push', '-q', 'origin', 'main');
    g(repo, 'remote', 'set-head', 'origin', 'main');
  }
  if (local !== undefined) {
    writeFileSync(join(repo, 'harness.config.json'), JSON.stringify(local));
    g(repo, 'commit', '-q', '-am', 'local');
  }
  const dir = join(repo, '.harness', 'entregas', ENTREGA);
  mkdirSync(dir, { recursive: true });
  const plano = { entrega: ENTREGA, tasks: tasks.map((id) => ({ id, deps: [], arquivos: [`src/${id}.txt`] })), ...planoExtra };
  writeFileSync(join(dir, 'plano.json'), JSON.stringify(plano));
  const m = { base, repo, marcas, dir };
  for (const id of integradas) integrar(m, id);
  fechar(m); // REQ-APR-2 muda a ordem: o fechamento abre pendência de aprendizado antes do `concluir`
  if (registro) commitarRegistro(m); // REQ-REG-1: `decidir`/`preparar` com `concluir` exigem o registro.md no HEAD
  if (homolog !== null) ev(m, 'ci.resultado', { verde: homolog, alvo: 'homolog' });
  return m;
}

/** Registro de fixture commitado só pelo caminho (o CLI real é coberto em `registro-real-…`). */
function commitarRegistro(m, texto = 'registro de fixture\n') {
  writeFileSync(join(m.dir, 'registro.md'), texto);
  g(m.repo, 'add', '--', '.harness/entregas/GM-10/registro.md');
  g(m.repo, 'commit', '-q', '-m', 'docs(GM-10): registro da entrega', '--', '.harness/entregas/GM-10/registro.md');
}

function ev(m, tipo, dados, sessao = 'loop') {
  const r = diario.append(m.dir, sessao, { ts: new Date().toISOString(), autor: 't', sessao, agente: 'orquestrador', tipo, dados });
  assert.equal(r.ok, true, `preparo: ${tipo} não gravado: ${r.erro}`);
}
function integrar(m, task) {
  ev(m, 'task.iniciada', { task, papel: 'implementador' });
  ev(m, 'task.concluida', { task, sha: 'a'.repeat(40) });
  ev(m, 'review.veredito', { task, veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 });
  ev(m, 'task.integrada', { task, sha: 'b'.repeat(40) });
}
/** REQ-APR-2 muda a ordem: fecha o que está aberto (fechamento, MAJOR, parar) para o teste seguir ao que ele prova. Só o que `pendenciasAprendizado` devolve. */
const fechar = (m) => fecharPendenciasNoDiario(m.dir, JSON.parse(readFileSync(join(m.dir, 'plano.json'), 'utf8')));
const eventos = (m) => diario.ler(m.dir);
const tiposDesde = (m, n) => eventos(m).slice(n).map((e) => e.tipo);
const marca = (m, nome) => existsSync(join(m.marcas, nome));
const execLog = (m) => (existsSync(join(m.marcas, 'exec.log')) ? readFileSync(join(m.marcas, 'exec.log'), 'utf8').split('\n').filter(Boolean) : []);
const textoDoDiario = (m) => readdirSync(m.dir).filter((n) => /^events\..+\.jsonl$/.test(n)).map((n) => readFileSync(join(m.dir, n), 'utf8')).join('\n');

function rodar(m, cmd, extra = [], { cwd = m.repo, entrega = ENTREGA } = {}) {
  const args = [SCRIPT, ...(cmd ? [cmd] : []), ...(entrega ? ['--entrega', entrega] : []), ...extra];
  const t0 = performance.now();
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 60_000 });
  const linhas = r.stdout.split('\n').filter(Boolean);
  assert.equal(linhas.length, 1, `stdout deve ser UMA linha JSON, veio: ${JSON.stringify(r.stdout)} (stderr: ${r.stderr})`);
  return { rc: r.status, json: JSON.parse(linhas[0]), ms: performance.now() - t0, stdout: r.stdout };
}
function rodarAsync(m, cmd) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SCRIPT, cmd, '--entrega', ENTREGA], { cwd: m.repo, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (b) => { out += b; });
    p.on('close', (rc) => resolve({ rc, json: JSON.parse(out.split('\n').filter(Boolean)[0]) }));
  });
}
/** `append` que falha onde `quando(ev, n)` manda; as outras chamadas seguem para o diário real. */
const appendQueFalha = (quando, erro = 'forma_invalida: falha injetada') => {
  let n = 0;
  return (dir, sessao, e, o) => (quando(e, ++n) ? { ok: false, erro } : diario.append(dir, sessao, e, o));
};

const JANELA_UTC = { dias: [0, 1, 2, 3, 4, 5, 6], inicio: '02:00', fim: '04:00', fuso: 'UTC' };

describe('registro commitado (REQ-REG-1, FX6/D1)', () => {
  const LOOP = join(AQUI, '..', 'scripts', 'loop.mjs');
  const REG = '.harness/entregas/GM-10/registro.md';

  test('registro-nao-rastreado (t3): decidir recusa com registro_nao_commitado e o comando; nada gravado no diário', () => {
    const m = montar({ registro: false });
    writeFileSync(join(m.dir, 'registro.md'), 'gerado, nunca commitado\n'); // existe no disco: só existsSync passaria
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'decidir');
    assert.equal(json.ok, false);
    assert.equal(json.erro, 'registro_nao_commitado');
    assert.notEqual(rc, 0);
    assert.match(json.mensagem, /loop\.mjs registro --entrega GM-10/);
    assert.equal(eventos(m).length, antes);
  });

  test('registro-ausente: sem arquivo algum ⇒ o mesmo erro', () => {
    const m = montar({ registro: false });
    assert.equal(rodar(m, 'decidir').json.erro, 'registro_nao_commitado');
  });

  test('registro-alterado-sem-commit (t4): rastreado, mas diferente do HEAD ⇒ registro_nao_commitado', () => {
    const m = montar();
    writeFileSync(join(m.dir, 'registro.md'), 'editado depois do commit\n');
    const { json } = rodar(m, 'decidir');
    assert.equal(json.erro, 'registro_nao_commitado');
    assert.match(json.mensagem, /mudança sem commit/);
  });

  test('registro-commitado (t5): decidir segue como antes (decisão `subir` com a política continua)', () => {
    const m = montar();
    const { rc, json } = rodar(m, 'decidir');
    assert.equal(rc, 0, JSON.stringify(json));
    assert.equal(json.ok, true);
    assert.deepEqual(json.decisao, { tipo: 'subir' });
  });

  test('registro-real-costura: `loop.mjs registro` real commita e `decidir` real passa; mexer no diário e não regerar não derruba (registro é o do HEAD)', () => {
    const m = montar({ registro: false });
    assert.equal(rodar(m, 'decidir').json.erro, 'registro_nao_commitado');
    const r = spawnSync(process.execPath, [LOOP, 'registro', '--entrega', ENTREGA], { cwd: m.repo, encoding: 'utf8' });
    const j = JSON.parse(r.stdout.trim());
    assert.equal(j.ok, true, r.stdout + r.stderr);
    assert.equal(typeof j.commit, 'string');
    assert.equal(g(m.repo, 'ls-tree', '--name-only', 'HEAD', REG).trim(), REG);
    const d = rodar(m, 'decidir');
    assert.equal(d.json.ok, true, JSON.stringify(d.json));
    assert.deepEqual(d.json.decisao, { tipo: 'subir' });
  });
});

describe('executar: etapas e desfechos', { concurrency: 4 }, () => {
  test('sucesso-entregue', async () => {
    const m = montar();
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 0);
    assert.equal(json.ok, true);
    assert.deepEqual(json.decisao, { tipo: 'subir' });
    assert.deepEqual(json.etapas.map((e) => [e.etapa, e.ok, e.saida]), [['deploy', true, 'ola-deploy\n'], ['smoke', true, 'ola-smoke\n']]);
    assert.equal(json.etapas[0].comando, `bash ${join(m.repo, 'fake', 'deploy.sh')}`);
    assert.equal(json.etapas[1].comando, `bash ${join(m.repo, 'fake', 'smoke.sh')}`);
    assert.equal(marca(m, 'deploy'), true);
    assert.equal(marca(m, 'smoke'), true);
    assert.equal(marca(m, 'rollback'), false);
    // a ordem é o contrato (D8-8): o acesso a prod vem antes do `inicio`
    assert.deepEqual(tiposDesde(m, antes), ['producao.acesso', 'entrega.inicio', 'entrega.smoke', 'entrega.fim']);
    const novos = eventos(m).slice(antes);
    assert.deepEqual(novos[0].dados, { ambiente: 'prod', acao: 'escrita', alvo: 'entrega:deploy' });
    assert.deepEqual(novos[1].dados, { politica: 'continua' });
    assert.deepEqual(novos[2].dados, { ok: true });
    assert.deepEqual(novos[3].dados, { ok: true });
    for (const e of novos) {
      assert.equal(e.sessao, 'loop');
      assert.equal(e.agente, 'orquestrador');
      assert.equal(e.autor, 't@t.test');
    }
    assert.ok(json.systemMessage.includes(json.etapas[0].comando) && json.systemMessage.includes(json.etapas[1].comando));
    assert.equal(existsSync(join(m.dir, 'entrega.lock')), false, 'o lock sai no finally');
  });

  test('smoke-falho-rollback-parar', () => {
    const m = montar({ scripts: { smoke: 'echo smoke-quebrou >&2\nexit 1' } });
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    assert.equal(json.ok, false);
    assert.equal(json.erro, 'etapa_falhou');
    assert.deepEqual(json.etapas.map((e) => [e.etapa, e.ok]), [['deploy', true], ['smoke', false], ['rollback', true]]);
    assert.equal(json.etapas[1].falha, 'rc');
    assert.equal(json.etapas[1].saida, 'smoke-quebrou\n');
    assert.match(json.systemMessage, /^deploy: bash .+deploy\.sh \(ok\); smoke: bash .+smoke\.sh \(falhou\); rollback: bash .+rollback\.sh \(ok\)$/);
    assert.match(json.mensagem, /smoke falhou; rollback feito/);
    assert.equal(marca(m, 'rollback'), true, 'o rollback rodou (aceite 3)');
    assert.deepEqual(tiposDesde(m, antes), [
      'producao.acesso', 'entrega.inicio', 'entrega.smoke', 'producao.acesso', 'entrega.rollback', 'entrega.fim', 'loop.parar',
    ]);
    const n = eventos(m).slice(antes);
    assert.deepEqual(n[2].dados, { ok: false });
    assert.deepEqual(n[3].dados, { ambiente: 'prod', acao: 'escrita', alvo: 'entrega:rollback' });
    assert.deepEqual(n[4].dados, { ok: true });
    assert.deepEqual(n[5].dados, { ok: false, motivo: 'smoke' });
    assert.deepEqual(n[6].dados, { motivo: 'smoke' });
    assert.equal(existsSync(join(m.dir, 'entrega.lock')), false);
  });

  test('rollback-falho-parar-rollback', () => {
    const m = montar({ scripts: { smoke: 'exit 1', rollback: 'touch "$M/rollback"\nexit 2' } });
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    assert.equal(json.erro, 'etapa_falhou');
    assert.equal(json.etapas[2].etapa, 'rollback');
    assert.equal(json.etapas[2].ok, false);
    const n = eventos(m).slice(antes);
    assert.deepEqual(n.map((e) => e.tipo).slice(-3), ['entrega.rollback', 'entrega.fim', 'loop.parar']);
    assert.deepEqual(n[n.length - 3].dados, { ok: false });
    assert.deepEqual(n[n.length - 2].dados, { ok: false, motivo: 'rollback' });
    assert.deepEqual(n[n.length - 1].dados, { motivo: 'rollback' });
  });

  test('deploy-falho-roda-rollback', () => {
    const m = montar({ scripts: { deploy: 'exit 3' } });
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    assert.deepEqual(json.etapas.map((e) => [e.etapa, e.ok]), [['deploy', false], ['rollback', true]]);
    assert.equal(json.etapas[0].falha, 'rc');
    assert.equal(marca(m, 'rollback'), true);
    assert.equal(marca(m, 'smoke'), false, 'smoke não roda depois de deploy falho');
    const n = eventos(m).slice(antes);
    assert.deepEqual(n.map((e) => e.tipo), ['producao.acesso', 'entrega.inicio', 'producao.acesso', 'entrega.rollback', 'entrega.fim', 'loop.parar']);
    // D6: deploy falho vira `motivo:'deploy'` e `nao_conseguiu`, nunca `smoke`
    assert.deepEqual(n[4].dados, { ok: false, motivo: 'deploy' });
    assert.deepEqual(n[5].dados, { motivo: 'nao_conseguiu' });
  });

  test('deploy-falho-sem-entrega-smoke', () => {
    const m = montar({ scripts: { deploy: 'exit 3' } });
    const antes = eventos(m).length;
    rodar(m, 'executar');
    assert.equal(tiposDesde(m, antes).includes('entrega.smoke'), false);
  });

  test('deploy-falho-producao-acesso-do-rollback', () => {
    const m = montar({ scripts: { deploy: 'exit 3' } });
    const antes = eventos(m).length;
    rodar(m, 'executar');
    const acessos = eventos(m).slice(antes).filter((e) => e.tipo === 'producao.acesso').map((e) => e.dados);
    assert.deepEqual(acessos, [
      { ambiente: 'prod', acao: 'escrita', alvo: 'entrega:deploy' },
      { ambiente: 'prod', acao: 'escrita', alvo: 'entrega:rollback' },
    ]);
  });

  test('deploy-enoent-roda-rollback', () => {
    // deploy aponta para um executável que não existe
    const m2 = montar({ deployArgv: (base) => [join(base, 'nao existe', 'deploy')] });
    const antes = eventos(m2).length;
    const { rc, json } = rodar(m2, 'executar');
    assert.equal(rc, 1);
    assert.deepEqual(json.etapas.map((e) => [e.etapa, e.ok]), [['deploy', false], ['rollback', true]]);
    assert.equal(json.etapas[0].falha, 'erro');
    assert.equal(marca(m2, 'rollback'), true);
    assert.deepEqual(eventos(m2).slice(antes).find((e) => e.tipo === 'entrega.fim').dados, { ok: false, motivo: 'deploy' });
  });

  test('timeout-ignora-sigterm-falha-em-folga', () => {
    // `trap '' TERM` e 12 s de sono, prazo de 1 s: sem matar o grupo com SIGKILL, a etapa só volta em 12 s
    const m = montar({ scripts: { deploy: "trap '' TERM\nsleep 12" }, timeouts: { deploy: 1 } });
    const { rc, json, ms } = rodar(m, 'executar');
    assert.equal(rc, 1);
    assert.ok(ms < 8000, `a etapa deveria falhar em ~1 s, levou ${Math.round(ms)} ms`);
    assert.deepEqual(json.etapas.map((e) => [e.etapa, e.ok]), [['deploy', false], ['rollback', true]]);
    assert.equal(json.etapas[0].falha, 'timeout');
    assert.equal(marca(m, 'rollback'), true);
  });

  test('timeout-mata-neto', async () => {
    const m = montar({ scripts: { deploy: '(sleep 3; touch "$M/neto") &\nsleep 30' }, timeouts: { deploy: 1 } });
    const { json } = rodar(m, 'executar');
    assert.equal(json.etapas[0].falha, 'timeout');
    await dormir(4500);
    assert.equal(marca(m, 'neto'), false, 'o neto morreu com o grupo; o marcador não pode existir');
  });

  test('sucesso-com-background-nao-vira-falha', async () => {
    // o líder sai 0 e deixa um neto segurando o stdout além do prazo: decide o `exit` do líder, e o neto morre com o grupo
    const m = montar({ scripts: { deploy: '(sleep 2; touch "$M/bg") &\nexit 0' }, timeouts: { deploy: 1 } });
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 0);
    assert.equal(json.etapas[0].ok, true);
    assert.equal(json.etapas[0].falha, undefined);
    await dormir(3500);
    assert.equal(marca(m, 'bg'), false, 'o processo em background é morto ao sair o líder');
  });

  test('saida-grande-nao-enobufs', () => {
    const m = montar({ scripts: { deploy: 'yes abcdefghij | head -c 2097152\necho FIM_DA_SAIDA' } });
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 0);
    assert.equal(json.etapas[0].ok, true);
    assert.ok(json.etapas[0].saida.length <= 2000, `saida de ${json.etapas[0].saida.length} caracteres`);
    assert.ok(json.etapas[0].saida.endsWith('FIM_DA_SAIDA\n'), 'guarda os ÚLTIMOS caracteres');
  });

  test('saida-com-segredo-redigida', () => {
    const t = token();
    const m = montar({ scripts: { deploy: `echo linha-normal\necho "vazou ${t} fim"\necho outra-normal` } });
    const { rc, json, stdout } = rodar(m, 'executar');
    assert.equal(rc, 0);
    assert.equal(json.etapas[0].saida, 'linha-normal\n[redigido]\noutra-normal\n');
    assert.equal(stdout.includes(t), false);
    assert.equal(textoDoDiario(m).includes(t), false);
  });

  test('saida-cortada-no-meio-do-segredo-nao-vaza-o-resto', () => {
    // o anel de 2.000 caracteres começa no meio de uma linha com `ghp_…`: sem o prefixo o canário não casa, e o resto do token vazaria
    const filler = 'z'.repeat(1968);
    const m = montar({ scripts: { deploy: `printf 'ghp_%s\\n' $(printf 'B%.0s' $(seq 1 36))\nprintf '%s\\n' ${filler}` } });
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 0, JSON.stringify(json));
    const saida = json.etapas[0].saida;
    assert.ok(saida.length <= 2000);
    assert.equal(saida.includes('BBBBBBBB'), false, 'o pedaço de linha cortado ao meio foi descartado');
    assert.ok(saida.endsWith(`${filler}\n`));
  });

  const SEM_QUEBRA = (cauda) => `{ head -c 2000000 /dev/zero | tr '\\0' x; printf 'ghp_'; head -c 36 /dev/zero | tr '\\0' B; ${cauda}; }`;

  test('saida-linha-unica-gigante-com-segredo-cortado-nao-vaza', () => {
    // 2 MiB numa linha só, sem `\n` nem espaço: o anel começa 20 caracteres dentro do token; sem prefixo o canário não casa
    const m = montar({ scripts: { deploy: SEM_QUEBRA(`head -c 1980 /dev/zero | tr '\\0' z`) } });
    const { rc, json, stdout } = rodar(m, 'executar');
    assert.equal(rc, 0, JSON.stringify(json));
    assert.equal(json.etapas[0].saida, '[cortado]');
    assert.equal(stdout.includes('BBBBBBBB'), false);
    assert.equal(textoDoDiario(m).includes('BBBBBBBB'), false);
  });

  test('saida-linha-unica-gigante-descarta-ate-o-primeiro-espaco', () => {
    const m = montar({ scripts: { deploy: SEM_QUEBRA(`head -c 1973 /dev/zero | tr '\\0' z; printf ' fim-ok'`) } });
    const { rc, json, stdout } = rodar(m, 'executar');
    assert.equal(rc, 0, JSON.stringify(json));
    assert.equal(json.etapas[0].saida, 'fim-ok');
    assert.equal(stdout.includes('BBBBBBBB'), false);
  });

  test('comando-com-segredo-redigido', () => {
    const t = token();
    const m = montar({ extraArgv: [t] });
    const { rc, json, stdout } = rodar(m, 'executar');
    assert.equal(rc, 0);
    assert.equal(json.etapas[0].comando, '[redigido]');
    assert.equal(stdout.includes(t), false);
    assert.equal(json.etapas[1].comando, `bash ${join(m.repo, 'fake', 'smoke.sh')}`);
  });

  test('comando-nunca-no-diario', () => {
    const m = montar({ extraArgv: [SENTINELA], scripts: { deploy: 'exit 3' } });
    const { json, stdout } = rodar(m, 'executar');
    assert.ok(stdout.includes(SENTINELA), 'o comando aparece no stdout');
    assert.ok(json.etapas[0].comando.endsWith(` ${SENTINELA}`));
    assert.equal(textoDoDiario(m).includes(SENTINELA), false, 'o diário nunca carrega comando cru');
    for (const e of eventos(m).filter((x) => x.tipo === 'producao.acesso')) assert.equal(e.dados.alvo.includes(SENTINELA), false);
  });

  test('alvo-nunca-real', () => {
    const m = montar({ scripts: { smoke: 'exit 1' } });
    rodar(m, 'executar');
    const cfg = JSON.parse(readFileSync(join(m.repo, 'harness.config.json'), 'utf8'));
    for (const c of Object.values(cfg.entrega.comandos)) assert.ok(c.argv.slice(1).every((a) => a.startsWith(m.base)), 'todo argv está sob o mkdtemp');
    const log = execLog(m);
    assert.equal(log.length, 3);
    for (const l of log) {
      const [zero, pwd] = l.split('|');
      assert.ok(zero.startsWith(m.base) && pwd === m.repo, `execução fora do repo descartável: ${l}`);
    }
  });

  test('executar-da-worktree-roda-no-principal', () => {
    const m = montar();
    const wt = join(m.base, 'wt');
    g(m.repo, 'worktree', 'add', '-q', '-b', 'wtx', wt);
    const { rc } = rodar(m, 'executar', [], { cwd: wt });
    assert.equal(rc, 0);
    assert.deepEqual(execLog(m).map((l) => l.split('|')[1]), [m.repo, m.repo], 'o comando roda na raiz do principal');
    assert.equal(eventos(m).some((e) => e.tipo === 'entrega.fim'), true, 'o diário é o do principal');
  });

  test('entrega-inferida-da-branch', () => {
    const m = montar();
    g(m.repo, 'checkout', '-q', '-b', 'feat/GM-10-x');
    const { rc, json } = rodar(m, 'executar', [], { entrega: null });
    assert.equal(rc, 0, JSON.stringify(json));
  });

  test('sessao-flag-grava-na-sessao-pedida', () => {
    const m = montar();
    rodar(m, 'executar', ['--sessao', 'minha-sessao']);
    assert.equal(existsSync(join(m.dir, 'events.minha-sessao.jsonl')), true);
    const txt = readFileSync(join(m.dir, 'events.minha-sessao.jsonl'), 'utf8');
    assert.equal(txt.split('\n').filter(Boolean).length, 4);
  });
});

describe('executar: pré-condições (nada roda, nada se grava)', { concurrency: 4 }, () => {
  const semEfeito = (m, antes, json, erro) => {
    assert.equal(json.ok, false);
    assert.equal(json.erro, erro);
    assert.equal(execLog(m).length, 0, 'nenhum comando rodou');
    assert.equal(eventos(m).length, antes, 'nada foi gravado');
  };

  test('executar-entrega-incompleta-recusa', () => {
    // T2 ainda pendente e homolog verde depois da integração de T1
    const m = montar({ integradas: ['T1'] });
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    semEfeito(m, antes, json, 'entrega_incompleta');
    assert.equal(json.acao.tipo, 'despachar', 'a mensagem carrega a próxima ação do loop');
  });

  test('executar-com-proposta-aberta-recusa', () => {
    const m = montar();
    ev(m, 'emenda.proposta', { req: 'REQ-ENT-1', diff: 'd', fato: 'f', alternativa: 'a', evidencia: 'e', causa: 'tecnica' }, 'emendas');
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    semEfeito(m, antes, json, 'entrega_incompleta');
    // a única barreira é a do núcleo (`proximaAcao`), exercida pela borda: a mensagem carrega a ação do loop
    assert.equal(json.acao.tipo, 'esperar');
    assert.equal(json.acao.motivo, 'emenda');
    assert.deepEqual(json.acao.propostas.map((p) => p.seq), [eventos(m).find((e) => e.tipo === 'emenda.proposta').seq]);
  });

  test('executar-pausado-recusa', () => {
    const m = montar();
    mkdirSync(join(m.repo, '.harness'), { recursive: true });
    writeFileSync(join(m.repo, '.harness', 'PAUSAR'), '');
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    semEfeito(m, antes, json, 'pausado');
    assert.equal(existsSync(join(m.dir, 'entrega.lock')), false, 'recusa também solta o lock');
  });

  test('executar-pausado-so-na-worktree-recusa', () => {
    const m = montar();
    const wt = join(m.base, 'wt');
    g(m.repo, 'worktree', 'add', '-q', '-b', 'wtx', wt);
    mkdirSync(join(wt, '.harness'), { recursive: true });
    writeFileSync(join(wt, '.harness', 'PAUSAR'), '');
    const antes = eventos(m).length;
    const { json } = rodar(m, 'executar', [], { cwd: wt });
    semEfeito(m, antes, json, 'pausado');
  });

  test('decidir-pausado-recusa', () => {
    const m = montar();
    mkdirSync(join(m.repo, '.harness'), { recursive: true });
    writeFileSync(join(m.repo, '.harness', 'PAUSAR'), '');
    const { rc, json } = rodar(m, 'decidir');
    assert.equal(rc, 1);
    assert.equal(json.erro, 'pausado');
  });

  test('executar-checkout-sujo-recusa', () => {
    const m = montar();
    appendFileSync(join(m.repo, 'fake', 'deploy.sh'), 'touch "$M/malicioso"\n');
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    semEfeito(m, antes, json, 'checkout_sujo');
    assert.equal(marca(m, 'malicioso'), false);
  });

  test('executar-arquivo-novo-nao-rastreado-nao-e-sujo', () => {
    // vizinho: a regra é "mudança RASTREADA" (`--untracked-files=no`); `.harness/` e um arquivo novo solto não travam
    const m = montar();
    writeFileSync(join(m.repo, 'solto.txt'), 'x\n');
    const { rc } = rodar(m, 'executar');
    assert.equal(rc, 0);
  });

  test('executar-diario-versionado-modificado-nao-e-sujo', () => {
    // o diário é versionado na branch (visão): evento novo modifica arquivo rastreado e não pode travar a próxima entrega
    const m = montar();
    g(m.repo, 'add', '-f', '.harness/entregas');
    g(m.repo, 'commit', '-q', '-m', 'diario');
    ev(m, 'ci.resultado', { verde: true, alvo: 'homolog' });
    assert.notEqual(g(m.repo, 'status', '--porcelain', '--untracked-files=no').trim(), '', 'preparo: o diário rastreado está modificado');
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 0, JSON.stringify(json));
  });

  /** versiona (`-f`) a pasta da entrega e commita: o diário e o plano passam a ser arquivos rastreados. */
  const versionarEntregas = (m) => {
    g(m.repo, 'add', '-f', '.harness/entregas');
    g(m.repo, 'commit', '-q', '-m', 'entregas');
  };

  test('executar-script-rastreado-sob-entregas-alterado-e-sujo', () => {
    // o comando declarado em origin aponta para um script versionado sob `.harness/entregas/<id>/`: alterado sem commit, não roda (D8-5)
    const m = montar({ deployArgv: (base) => ['bash', join(base, 'repo com espaço', '.harness', 'entregas', ENTREGA, 'deploy.sh')] });
    writeFileSync(join(m.dir, 'deploy.sh'), `M='${m.marcas}'\ntouch "$M/deploy"\n`);
    versionarEntregas(m);
    appendFileSync(join(m.dir, 'deploy.sh'), 'touch "$M/malicioso"\n');
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    semEfeito(m, antes, json, 'checkout_sujo');
    assert.equal(marca(m, 'malicioso'), false);
    assert.equal(marca(m, 'deploy'), false);
  });

  test('executar-plano-rastreado-alterado-e-sujo', () => {
    // `plano.json` decide `concluir` e aperta a política: alterado sem commit conta como sujo
    const m = montar();
    versionarEntregas(m);
    writeFileSync(join(m.dir, 'plano.json'), `${readFileSync(join(m.dir, 'plano.json'), 'utf8')}\n`);
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    semEfeito(m, antes, json, 'checkout_sujo');
    assert.match(json.mensagem, /plano\.json/);
  });

  test('executar-arquivo-de-diario-em-subpasta-alterado-e-sujo', () => {
    // só `events.*.jsonl` direto na pasta da entrega fica de fora: o mesmo nome numa subpasta é arquivo comum
    const m = montar();
    mkdirSync(join(m.dir, 'sub'));
    writeFileSync(join(m.dir, 'sub', 'events.x.jsonl'), 'a\n');
    versionarEntregas(m);
    appendFileSync(join(m.dir, 'sub', 'events.x.jsonl'), 'b\n');
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    semEfeito(m, antes, json, 'checkout_sujo');
  });

  test('executar-lock-existente-recusa', () => {
    const m = montar();
    writeFileSync(join(m.dir, 'entrega.lock'), 'de outro processo\n');
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    semEfeito(m, antes, json, 'entrega_em_curso');
    assert.ok(json.mensagem.includes('entrega.lock'), 'a mensagem cita o arquivo');
    assert.equal(readFileSync(join(m.dir, 'entrega.lock'), 'utf8'), 'de outro processo\n', 'lock órfão não é quebrado nem apagado');
  });

  test('executar-concorrente-um-deploy', async () => {
    const m = montar({ scripts: { deploy: 'echo x >> "$M/contagem"\nsleep 2' } });
    const [a, b] = await Promise.all([rodarAsync(m, 'executar'), rodarAsync(m, 'executar')]);
    const perdedor = [a, b].find((r) => r.json.ok === false);
    const vencedor = [a, b].find((r) => r.json.ok === true);
    assert.ok(perdedor && vencedor, JSON.stringify([a.json, b.json]));
    assert.equal(perdedor.json.erro, 'entrega_em_curso');
    assert.equal(perdedor.rc, 1);
    assert.equal(vencedor.rc, 0);
    assert.equal(readFileSync(join(m.marcas, 'contagem'), 'utf8').split('\n').filter(Boolean).length, 1, 'um deploy só');
  });

  test('executar-release-pr-nao-subiu', () => {
    const m = montar({ politica: 'sob_demanda' });
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    semEfeito(m, antes, json, 'nao_subiu');
    assert.deepEqual(json.decisao, { tipo: 'release_pr', base: 'main' });
  });

  test('executar-entregue-idempotente-rc0', () => {
    const m = montar();
    ev(m, 'entrega.inicio', { politica: 'continua' });
    ev(m, 'entrega.fim', { ok: true });
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 0);
    assert.equal(json.ok, true);
    assert.deepEqual(json.decisao, { tipo: 'entregue' });
    assert.equal(execLog(m).length, 0);
    assert.equal(eventos(m).length, antes, 'nada gravado');
  });

  test('executar-apos-inicio-sem-fim-nao-roda', () => {
    const m = montar();
    ev(m, 'entrega.inicio', { politica: 'continua' });
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    semEfeito(m, antes, json, 'nao_subiu');
    assert.deepEqual(json.decisao, { tipo: 'parar', motivo: 'nao_conseguiu' });
  });

  test('entrega-recusa-com-pendencia: tudo integrado e homolog verde, mas o aprendizado do fechamento está aberto ⇒ entrega_incompleta citando `aprender`, nada roda, nada se grava; fechado, sobe', () => {
    const m = montar();
    // o fechamento que `montar` fechou segue fechado; uma mensagem do dono (hash e tamanho, nunca o texto) abre a pendência `dono`
    ev(m, 'dono.mensagem', { sha256: 'a'.repeat(64), chars: 12 }, 'dono');
    const antes = eventos(m).length;
    for (const cmd of ['decidir', 'executar']) {
      const { rc, json } = rodar(m, cmd);
      assert.equal(rc, 1, cmd);
      assert.equal(json.ok, false, cmd);
      assert.equal(json.erro, 'entrega_incompleta', cmd);
      assert.match(json.mensagem, /próxima ação do loop: aprender/, cmd);
      assert.equal(json.acao.tipo, 'aprender', cmd);
      assert.deepEqual(json.acao.pendencias, [{ sessao: 'dono', seq: 1, tipo: 'dono' }], cmd);
    }
    assert.equal(execLog(m).length, 0, 'nenhum comando rodou');
    assert.equal(eventos(m).length, antes, 'nada foi gravado');
    fechar(m);
    ev(m, 'ci.resultado', { verde: true, alvo: 'homolog' });
    assert.deepEqual(rodar(m, 'decidir').json.decisao, { tipo: 'subir' });
  });

  test('inicio-orfao-antigo-ainda-para-mesmo-com-integracao-nova', () => {
    const m = montar({ tasks: ['T1', 'T2', 'T3'], integradas: ['T1', 'T2'] });
    ev(m, 'entrega.inicio', { politica: 'continua' });
    integrar(m, 'T3');
    fechar(m);
    ev(m, 'ci.resultado', { verde: true, alvo: 'homolog' });
    const antes = eventos(m).length;
    const { json } = rodar(m, 'executar');
    semEfeito(m, antes, json, 'nao_subiu');
    assert.deepEqual(json.decisao, { tipo: 'parar', motivo: 'nao_conseguiu' });
  });

  test('executar-apos-correcao-integrada-sobe', () => {
    // D8-7: `entrega.fim {ok:false, motivo:'smoke'}` e depois uma task de correção integrada com homolog verde ⇒ nova tentativa
    const m = montar({ tasks: ['T1', 'T2', 'T3'], integradas: ['T1', 'T2'] });
    ev(m, 'entrega.inicio', { politica: 'continua' });
    ev(m, 'entrega.smoke', { ok: false });
    ev(m, 'entrega.rollback', { ok: true });
    ev(m, 'entrega.fim', { ok: false, motivo: 'smoke' });
    ev(m, 'loop.parar', { motivo: 'smoke' });
    // sem a correção integrada, a decisão continua `parar{smoke}` (T3 pendente ⇒ entrega incompleta)
    assert.equal(rodar(m, 'executar').json.erro, 'entrega_incompleta');
    integrar(m, 'T3');
    fechar(m);
    ev(m, 'ci.resultado', { verde: true, alvo: 'homolog' });
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 0, JSON.stringify(json));
    assert.deepEqual(json.decisao, { tipo: 'subir' });
    assert.equal(marca(m, 'deploy'), true);
  });

  test('politica-afrouxada-recusa', () => {
    const m = montar({ politica: 'janela', janela: JANELA_UTC, planoExtra: { politica_entrega: { politica: 'continua', exige_prod: false } } });
    const antes = eventos(m).length;
    const dec = rodar(m, 'decidir');
    assert.equal(dec.rc, 1);
    assert.equal(dec.json.erro, 'politica_afrouxada');
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    semEfeito(m, antes, json, 'politica_afrouxada');
  });

  test('janela-ausente-recusa', () => {
    const m = montar({ politica: 'continua', planoExtra: { politica_entrega: { politica: 'janela', exige_prod: false } } });
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    assert.equal(json.erro, 'janela_ausente');
    assert.equal(execLog(m).length, 0);
  });

  test('config-local-ignorada', () => {
    // local `continua` (commitado só no local), origin `sob_demanda`
    const origemSob = { entrega: { politica: 'sob_demanda', comandos: {} } };
    const m = montar({ origem: origemSob, local: { entrega: { politica: 'continua', comandos: { deploy: { argv: ['bash', '-c', 'touch /nao/deve/rodar'] } } } } });
    const dec = rodar(m, 'decidir');
    assert.equal(dec.rc, 0);
    assert.deepEqual(dec.json.decisao, { tipo: 'release_pr', base: 'main' });
    assert.equal(dec.json.politica, 'sob_demanda');
    const ex = rodar(m, 'executar');
    assert.equal(ex.rc, 1);
    assert.equal(ex.json.erro, 'nao_subiu');
    assert.equal(execLog(m).length, 0);
  });

  test('config-local-autonomia-ignorada', () => {
    // local `autonomia: true` (commitado só no local); origin `continua` sem a chave: a autonomia é de origin/HEAD (M-AUT1a)
    const origem = { entrega: { politica: 'continua', comandos: {} } };
    const m = montar({ origem, local: { entrega: { politica: 'continua', autonomia: true, comandos: {} } } });
    const dec = rodar(m, 'decidir');
    assert.equal(dec.rc, 0, JSON.stringify(dec.json));
    assert.deepEqual(dec.json.decisao, { tipo: 'release_pr', base: 'main' });
    assert.equal(dec.json.politica, 'sob_demanda');
    assert.equal(execLog(m).length, 0);
  });

  test('autonomia-de-origin-sobe-e-ausente-ou-corrompida-nao', () => {
    // costura: config bruto de origin/HEAD pelo CLI real ⇒ lerConfigEntrega ⇒ politicaEfetiva ⇒ decidirEntrega
    const sobe = rodar(montar({ autonomia: true }), 'decidir');
    assert.deepEqual(sobe.json.decisao, { tipo: 'subir' });
    assert.equal(sobe.json.politica, 'continua');
    const ausente = rodar(montar({ semAutonomia: true }), 'decidir').json;
    assert.deepEqual(ausente.decisao, { tipo: 'release_pr', base: 'main' });
    assert.equal(ausente.politica, 'sob_demanda');
    assert.equal('aviso' in ausente, false, 'ausente não é corrompido: sem aviso');
    const texto = rodar(montar({ autonomia: 'sim' }), 'decidir').json;
    assert.deepEqual(texto.decisao, { tipo: 'release_pr', base: 'main' });
    assert.equal(texto.politica, 'sob_demanda');
    assert.match(texto.aviso, /entrega\.autonomia: esperado booleano/);
  });

  test('plano-continua-autonomia-ausente-afrouxada: o plano que pede continua não sobe sem entrega.autonomia', () => {
    const m = montar({ semAutonomia: true, planoExtra: { politica_entrega: { politica: 'continua', exige_prod: false } } });
    const antes = eventos(m).length;
    const dec = rodar(m, 'decidir');
    assert.equal(dec.rc, 1);
    assert.equal(dec.json.erro, 'politica_afrouxada');
    assert.match(dec.json.mensagem ?? JSON.stringify(dec.json), /sem entrega\.autonomia/);
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    semEfeito(m, antes, json, 'politica_afrouxada');
  });

  test('sem-origin-sob-demanda', () => {
    const m = montar({ semOrigin: true });
    const dec = rodar(m, 'decidir');
    assert.equal(dec.rc, 0);
    assert.deepEqual(dec.json.decisao, { tipo: 'release_pr', base: 'main' });
    assert.equal(dec.json.politica, 'sob_demanda');
    assert.match(dec.json.aviso, /^base do HEAD: origin\/HEAD sem entrega\.base/, 'ausente não é corrompido: só o aviso de base (FX8; o HEAD da fixture declara main), sem "inválida"');
    assert.doesNotMatch(dec.json.aviso, /inválid/);
    assert.equal(rodar(m, 'executar').json.erro, 'nao_subiu');
  });
});

describe('ausente x corrompido', { concurrency: 4 }, () => {
  test('config-ausente-x-corrompida', () => {
    // 1) origin sem o arquivo; 2) JSON inválido; 3) `entrega` de forma errada; 4) raiz que não é objeto: quatro saídas, nenhuma sucesso
    const semArquivo = rodar(montar({ origem: false }), 'decidir').json;
    assert.deepEqual(semArquivo.decisao, { tipo: 'release_pr', base: 'main' });
    assert.match(semArquivo.aviso, /^nenhuma base declarada/);
    assert.doesNotMatch(semArquivo.aviso, /inválid/);
    const invalida = rodar(montar({ origem: '{não é json' }), 'decidir').json;
    assert.deepEqual(invalida.decisao, { tipo: 'release_pr', base: 'main' });
    assert.equal(invalida.politica, 'sob_demanda');
    assert.match(invalida.aviso, /config de origin inválida/);
    const formaErrada = rodar(montar({ origem: { entrega: 'x' } }), 'decidir').json;
    assert.deepEqual(formaErrada.decisao, { tipo: 'release_pr', base: 'main' });
    assert.match(formaErrada.aviso, /entrega: esperado objeto/);
    assert.doesNotMatch(formaErrada.aviso, /config de origin inválida/);
    const array = rodar(montar({ origem: '[1,2]' }), 'decidir').json;
    assert.match(array.aviso, /config de origin inválida/);
  });

  test('config-origin-invalida-aviso', () => {
    const m = montar({ origem: '{não é json' });
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    assert.equal(json.erro, 'nao_subiu');
    assert.match(json.aviso, /config de origin inválida/);
    assert.equal(execLog(m).length, 0);
  });

  test('plano-ausente-x-corrompido-x-diario', () => {
    const m1 = montar();
    const m2 = montar();
    const m3 = montar();
    const m4 = montar({ integradas: [], homolog: null });
    // plano ausente
    renameSync(join(m1.dir, 'plano.json'), join(m1.base, 'plano.guardado'));
    const a = rodar(m1, 'executar');
    assert.equal(a.rc, 1);
    assert.equal(a.json.erro, 'plano_ausente');
    // plano corrompido
    writeFileSync(join(m2.dir, 'plano.json'), '{nope');
    const b = rodar(m2, 'executar');
    assert.equal(b.json.erro, 'plano_invalido');
    // diário corrompido (linha torta)
    appendFileSync(join(m3.dir, 'events.loop.jsonl'), 'lixo que não é json\n');
    const c = rodar(m3, 'executar');
    assert.equal(c.rc, 1);
    assert.equal(c.json.erro, 'diario_ilegivel');
    // diário vazio (ausente): não é erro de leitura, é entrega incompleta
    const d = rodar(m4, 'executar');
    assert.equal(d.json.erro, 'entrega_incompleta');
    for (const m of [m1, m2, m3, m4]) assert.equal(execLog(m).length, 0);
  });

  test('diario-pasta-ausente-decidir-nao-lanca', () => {
    const m = montar({ integradas: [], homolog: null });
    const r = rodar(m, 'decidir');
    assert.equal(r.rc, 1);
    assert.equal(r.json.erro, 'entrega_incompleta');
  });
});

describe('uso e forma', { concurrency: 4 }, () => {
  test('uso-errado-rc2', () => {
    const m = montar();
    for (const args of [[], ['nada'], ['executar', 'sobra'], ['executar', 'xxentrega', 'GM-10'], ['decidir', '--desconhecida', 'x'], ['executar', '--entrega'], ['executar', '--entrega', 'GM-10', '--entrega', 'GM-10']]) {
      const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: m.repo, encoding: 'utf8' });
      assert.equal(r.status, 2, `args ${JSON.stringify(args)}`);
      const j = JSON.parse(r.stdout.trim());
      assert.equal(j.ok, false);
      assert.equal(j.erro, 'uso');
    }
  });

  test('forma-invalida-nao-toca-nada', () => {
    const m = montar();
    const antes = eventos(m).length;
    for (const extra of [['--entrega', 'gm-10'], ['--entrega', '../x']]) {
      const r = spawnSync(process.execPath, [SCRIPT, 'executar', ...extra], { cwd: m.repo, encoding: 'utf8' });
      assert.equal(r.status, 1);
      assert.equal(JSON.parse(r.stdout.trim()).erro, 'entrega_invalida');
    }
    const s = rodar(m, 'executar', ['--sessao', '../x']);
    assert.equal(s.rc, 1);
    assert.equal(s.json.erro, 'argumento_invalido');
    assert.equal(eventos(m).length, antes);
    assert.equal(execLog(m).length, 0);
  });

  test('fora-de-repo-falha', () => {
    const fora = realpathSync(mkdtempSync(join(tmpdir(), 'entrega fora ')));
    const r = spawnSync(process.execPath, [SCRIPT, 'decidir', '--entrega', ENTREGA], { cwd: fora, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout.trim()).erro, 'fora_de_repo');
  });
});

describe('decidir', { concurrency: 4 }, () => {
  test('decidir-continua-sobe-sem-gravar', () => {
    const m = montar();
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'decidir');
    assert.equal(rc, 0);
    assert.equal(json.ok, true);
    assert.deepEqual(json.decisao, { tipo: 'subir' });
    assert.equal(json.politica, 'continua');
    assert.equal(eventos(m).length, antes, 'decidir não grava nada fora do agendar');
    assert.equal(execLog(m).length, 0, 'decidir nunca roda comando');
  });

  test('decidir-sem-homolog-espera', () => {
    const m = montar({ homolog: null });
    const { rc, json } = rodar(m, 'decidir');
    assert.equal(rc, 0);
    assert.deepEqual(json.decisao, { tipo: 'esperar', motivo: 'homolog' });
  });

  test('decidir-ignora-lock-e-checkout-sujo', () => {
    // sem lock e sem P7: só `executar` pega o lock e confere o checkout
    const m = montar();
    writeFileSync(join(m.dir, 'entrega.lock'), 'x\n');
    appendFileSync(join(m.repo, 'fake', 'deploy.sh'), '# sujo\n');
    const { rc, json } = rodar(m, 'decidir');
    assert.equal(rc, 0);
    assert.deepEqual(json.decisao, { tipo: 'subir' });
  });

  test('decidir-entrega-incompleta', () => {
    const m = montar({ integradas: ['T1'] });
    const { rc, json } = rodar(m, 'decidir');
    assert.equal(rc, 1);
    assert.equal(json.erro, 'entrega_incompleta');
  });

  test('agendar-grava-uma-vez', () => {
    const m = montar({ politica: 'janela', janela: JANELA_UTC });
    const quarta = Date.UTC(2026, 5, 10, 12, 0, 0);
    const antes = eventos(m).length;
    const a = decidirAgora(m.repo, { entrega: ENTREGA, agoraMs: quarta });
    const quando = new Date(Date.UTC(2026, 5, 11, 2, 0, 0)).toISOString();
    assert.equal(a.ok, true);
    assert.deepEqual(a.decisao, { tipo: 'agendar', quando });
    assert.equal(a.politica, 'janela');
    const b = decidirAgora(m.repo, { entrega: ENTREGA, agoraMs: quarta + 60_000 });
    assert.deepEqual(b.decisao, { tipo: 'agendar', quando });
    const agendadas = eventos(m).slice(antes).filter((e) => e.tipo === 'entrega.agendada');
    assert.equal(agendadas.length, 1, 'decidir 2× com a janela fechada grava uma `entrega.agendada`');
    assert.deepEqual(agendadas[0].dados, { quando });
    // um `quando` novo grava outra
    const c = decidirAgora(m.repo, { entrega: ENTREGA, agoraMs: Date.UTC(2026, 5, 11, 5, 0, 0) });
    assert.deepEqual(c.decisao, { tipo: 'agendar', quando: new Date(Date.UTC(2026, 5, 12, 2, 0, 0)).toISOString() });
    assert.equal(eventos(m).slice(antes).filter((e) => e.tipo === 'entrega.agendada').length, 2);
  });

  test('janela-aberta-decide-subir-sem-agendar', () => {
    const m = montar({ politica: 'janela', janela: JANELA_UTC });
    const antes = eventos(m).length;
    const r = decidirAgora(m.repo, { entrega: ENTREGA, agoraMs: Date.UTC(2026, 5, 10, 3, 0, 0) });
    assert.deepEqual(r.decisao, { tipo: 'subir' });
    assert.equal(eventos(m).length, antes);
  });

  test('decidir-agendar-falha-append-rc1', () => {
    const m = montar({ politica: 'janela', janela: JANELA_UTC });
    const antes = eventos(m).length;
    const r = decidirAgora(m.repo, {
      entrega: ENTREGA, agoraMs: Date.UTC(2026, 5, 10, 12, 0, 0), append: appendQueFalha((e) => e.tipo === 'entrega.agendada'),
    });
    assert.equal(r.ok, false);
    assert.equal(r.erro, 'evento_nao_gravado');
    assert.match(r.mensagem, /forma_invalida: /);
    assert.equal(rcDe(r), 1);
    assert.equal(eventos(m).length, antes);
  });

  test('janela-fechada-executar-nao-sobe', async () => {
    const m = montar({ politica: 'janela', janela: JANELA_UTC });
    const r = await executarEntrega(m.repo, { entrega: ENTREGA, agoraMs: Date.UTC(2026, 5, 10, 12, 0, 0) });
    assert.equal(r.ok, false);
    assert.equal(r.erro, 'nao_subiu');
    assert.equal(r.decisao.tipo, 'agendar');
    assert.equal(execLog(m).length, 0);
    assert.equal(eventos(m).some((e) => e.tipo === 'entrega.agendada'), false, 'executar não grava nada quando não sobe');
  });

  test('janela-aberta-executar-sobe-em-processo', async () => {
    const m = montar({ politica: 'janela', janela: JANELA_UTC });
    const r = await executarEntrega(m.repo, { entrega: ENTREGA, agoraMs: Date.UTC(2026, 5, 10, 3, 0, 0) });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(rcDe(r), 0);
    assert.equal(marca(m, 'deploy'), true);
    assert.deepEqual(eventos(m).find((e) => e.tipo === 'entrega.inicio').dados, { politica: 'janela' });
  });
});

describe('falha de append (D8-8)', { concurrency: 4 }, () => {
  test('append-falha-antes-do-deploy-sem-inicio-orfao', async () => {
    // a 2ª gravação (a do `entrega.inicio`, na ordem certa) falha: nada roda e não fica `inicio` órfão
    const m = montar();
    const antes = eventos(m).length;
    const r = await executarEntrega(m.repo, { entrega: ENTREGA, append: appendQueFalha((e, n) => n === 2) });
    assert.equal(r.ok, false);
    assert.equal(r.erro, 'evento_nao_gravado');
    assert.equal(rcDe(r), 1);
    assert.equal(execLog(m).length, 0, 'nada rodou');
    const tipos = tiposDesde(m, antes);
    assert.equal(tipos.includes('entrega.inicio'), false, 'sem `entrega.inicio` órfão');
    assert.equal(existsSync(join(m.dir, 'entrega.lock')), false);
    // e a próxima decisão não fica presa: sem `inicio` sem `fim`
    assert.deepEqual(decidirAgora(m.repo, { entrega: ENTREGA }).decisao, { tipo: 'subir' });
  });

  test('append-falha-no-primeiro-acesso-aborta-sem-nada', async () => {
    const m = montar();
    const antes = eventos(m).length;
    const r = await executarEntrega(m.repo, { entrega: ENTREGA, append: appendQueFalha((e, n) => n === 1, 'forma_invalida: [redigido]') });
    assert.equal(r.erro, 'evento_nao_gravado');
    assert.equal(execLog(m).length, 0);
    assert.equal(eventos(m).length, antes);
  });

  test('append-recusa-do-canario-tambem-aborta', async () => {
    // `append` devolve ok:true com `gravado:'recusa'` quando o canário barra: não é gravação do evento
    const m = montar();
    const r = await executarEntrega(m.repo, {
      entrega: ENTREGA, append: (d, s, e, o) => (e.tipo === 'producao.acesso' ? { ok: true, gravado: 'recusa' } : diario.append(d, s, e, o)),
    });
    assert.equal(r.erro, 'evento_nao_gravado');
    assert.equal(execLog(m).length, 0);
  });

  test('append-falha-apos-deploy-rollback-ainda-roda', async () => {
    // depois de `entrega.inicio` nenhuma falha de append interrompe deploy, smoke nem rollback: vira aviso e rc 1
    const m = montar({ scripts: { smoke: 'touch "$M/smoke"\nexit 1' } });
    const depoisDoInicio = (e) => ['entrega.smoke', 'producao.acesso', 'entrega.rollback', 'entrega.fim', 'loop.parar'].includes(e.tipo) && e.dados?.alvo !== 'entrega:deploy';
    const r = await executarEntrega(m.repo, { entrega: ENTREGA, append: appendQueFalha(depoisDoInicio) });
    assert.equal(marca(m, 'deploy'), true);
    assert.equal(marca(m, 'smoke'), true);
    assert.equal(marca(m, 'rollback'), true, 'o rollback rodou mesmo sem conseguir gravar');
    assert.equal(r.ok, false);
    assert.equal(rcDe(r), 1);
    assert.ok(Array.isArray(r.avisos) && r.avisos.length >= 4, JSON.stringify(r.avisos));
    assert.match(r.avisos[0], /entrega\.smoke/);
    assert.deepEqual(r.etapas.map((e) => e.etapa), ['deploy', 'smoke', 'rollback']);
  });

  test('append-falha-no-fim-sucesso-vira-rc1-e-proxima-decisao-para', async () => {
    const m = montar();
    const r = await executarEntrega(m.repo, { entrega: ENTREGA, append: appendQueFalha((e) => e.tipo === 'entrega.fim') });
    assert.equal(r.ok, false);
    assert.equal(r.erro, 'evento_nao_gravado');
    assert.equal(rcDe(r), 1);
    assert.equal(r.etapas.every((e) => e.ok), true, 'as etapas rodaram e passaram');
    assert.equal(r.avisos.length, 1);
    // `inicio` sem `fim` ⇒ a decisão seguinte é o lado seguro
    assert.deepEqual(decidirAgora(m.repo, { entrega: ENTREGA }).decisao, { tipo: 'parar', motivo: 'nao_conseguiu' });
  });
});

describe('costura (P9): CLI, diário real e núcleo', { concurrency: 4 }, () => {
  test('executar-pelo-adaptador-real-fecha-o-ciclo-no-nucleo', () => {
    const m = montar();
    const ex = rodar(m, 'executar');
    assert.equal(ex.rc, 0);
    // o diário que o CLI gravou, lido pelo núcleo do dist: a próxima decisão é `entregue` e `decidir` concorda
    assert.deepEqual(
      decidirEntrega({
        politica: 'continua', janela: null, exigeProd: false, base: 'main', agoraMs: Date.now(), eventos: eventos(m),
        comandos: { deploy: { argv: ['x'], timeout_s: 1 }, smoke: { argv: ['x'], timeout_s: 1 }, rollback: { argv: ['x'], timeout_s: 1 } },
      }),
      { tipo: 'entregue' },
    );
    const dec = rodar(m, 'decidir');
    assert.deepEqual(dec.json.decisao, { tipo: 'entregue' });
    const de2 = rodar(m, 'executar');
    assert.equal(de2.rc, 0);
    assert.equal(execLog(m).length, 2, 'a 2ª execução não roda deploy de novo');
  });

  test('smoke-falho-fica-parado-ate-nova-integracao', () => {
    const m = montar({ scripts: { smoke: 'exit 1' } });
    assert.equal(rodar(m, 'executar').rc, 1);
    fechar(m);
    const dec = rodar(m, 'decidir');
    assert.deepEqual(dec.json.decisao, { tipo: 'parar', motivo: 'smoke' });
    assert.equal(rodar(m, 'executar').json.erro, 'nao_subiu');
    assert.equal(execLog(m).length, 3, 'deploy, smoke e rollback: nada roda de novo');
  });
});

describe('r2: diário adulterado, ordem do lock, sinal e chave PEM', { concurrency: 4 }, () => {
  const semEfeito = (m, antes, json, erro) => {
    assert.equal(json.ok, false);
    assert.equal(json.erro, erro);
    assert.equal(execLog(m).length, 0, 'nenhum comando rodou');
    assert.equal(eventos(m).length, antes, 'nada foi gravado');
  };
  const arqDiario = (m) => join(m.dir, 'events.loop.jsonl');
  const reescrever = (m, filtro) => {
    const linhas = readFileSync(arqDiario(m), 'utf8').split('\n').filter(Boolean);
    writeFileSync(arqDiario(m), `${linhas.filter(filtro).join('\n')}\n`);
  };

  test('diario-linha-do-meio-apagada-nao-roda-nada', () => {
    // T1 integrada e homolog verde; depois um `entrega.inicio` órfão e outro `ci.resultado`; apagar só o `inicio` é a saída óbvia para "destravar"
    const m = montar();
    ev(m, 'entrega.inicio', { politica: 'continua' });
    ev(m, 'ci.resultado', { verde: true, alvo: 'homolog' });
    const antes = eventos(m).length;
    const r0 = rodar(m, 'executar');
    assert.equal(r0.json.erro, 'nao_subiu', 'com o `inicio` órfão no diário a decisão é parar');
    assert.equal(execLog(m).length, 0, 'com o `inicio` órfão no diário nada roda');
    reescrever(m, (l) => JSON.parse(l).tipo !== 'entrega.inicio');
    const depois = eventos(m).length;
    assert.equal(depois, antes - 1);
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    semEfeito(m, depois, json, 'diario_ilegivel');
    assert.match(json.mensagem, /cadeia de hash quebrada/);
    assert.equal(marca(m, 'deploy'), false);
    const d = rodar(m, 'decidir');
    assert.equal(d.json.erro, 'diario_ilegivel');
  });

  for (const [nome, linha] of [['array', '[]'], ['numero', '1'], ['null', 'null']]) {
    test(`diario-linha-nao-objeto-${nome}-nao-roda-nada`, () => {
      const m = montar();
      appendFileSync(arqDiario(m), `${linha}\n`);
      const antes = eventos(m).length;
      const { rc, json } = rodar(m, 'executar');
      assert.equal(rc, 1);
      semEfeito(m, antes, json, 'diario_ilegivel');
      assert.match(json.mensagem, /não é um objeto/);
    });
  }

  test('diario-arquivo-nao-regular-symlink-nao-roda-nada', () => {
    const m = montar();
    const vazio = join(m.base, 'vazio.jsonl');
    writeFileSync(vazio, '');
    symlinkSync(vazio, join(m.dir, 'events.x.jsonl'));
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    semEfeito(m, antes, json, 'diario_ilegivel');
    assert.match(json.mensagem, /events\.x\.jsonl: não é arquivo regular/);
  });

  test('lock-vem-antes-de-ler-o-diario', () => {
    // D8-2: o lock é pego ANTES de ler o diário. Com lock alheio E diário torto o erro é o do lock; se o lock viesse depois, seria `diario_ilegivel`
    const m = montar();
    appendFileSync(arqDiario(m), 'lixo que não é json\n');
    writeFileSync(join(m.dir, 'entrega.lock'), 'de outro processo\n');
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    assert.equal(execLog(m).length, 0);
    assert.equal(json.erro, 'entrega_em_curso');
    assert.equal(eventos(m).length, antes);
    assert.equal(readFileSync(join(m.dir, 'entrega.lock'), 'utf8'), 'de outro processo\n');
  });

  test('lock-vem-antes-do-checkout-sujo', () => {
    const m = montar();
    writeFileSync(join(m.repo, 'README.md'), 'mudou\n');
    writeFileSync(join(m.dir, 'entrega.lock'), 'de outro processo\n');
    const { json } = rodar(m, 'executar');
    assert.equal(json.erro, 'entrega_em_curso');
  });

  test('etapa-morta-por-sinal-e-falha-sinal-com-rollback', () => {
    const m = montar({ scripts: { deploy: 'kill -KILL $$' } });
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    assert.equal(json.erro, 'etapa_falhou');
    assert.deepEqual(json.etapas.map((e) => [e.etapa, e.ok]), [['deploy', false], ['rollback', true]]);
    assert.equal(json.etapas[0].falha, 'sinal');
    assert.equal(marca(m, 'rollback'), true);
  });

  const CHAVE = (n, tam = 64) => Array.from({ length: n }, (_, i) => `CORPO${String(i).padStart(2, '0')}${'k'.repeat(tam - 7)}`);
  const imprimir = (linhas) => linhas.map((l) => `echo '${l}'`).join('\n');

  test('chave-pem-inteira-redigida-corpo-e-end', () => {
    const corpo = CHAVE(4);
    const m = montar({ scripts: { deploy: imprimir(['antes', '-----BEGIN OPENSSH PRIVATE KEY-----', ...corpo, '-----END OPENSSH PRIVATE KEY-----', 'depois']) } });
    const { rc, json, stdout } = rodar(m, 'executar');
    assert.equal(rc, 0, JSON.stringify(json));
    assert.equal(json.etapas[0].saida, `antes\n${'[redigido]\n'.repeat(6)}depois\n`);
    assert.equal(stdout.includes('CORPO'), false);
    assert.equal(textoDoDiario(m).includes('CORPO'), false);
  });

  test('chave-pem-cortada-no-anel-sem-begin-redigida-ate-o-end', () => {
    // 40 linhas de 65 caracteres: o anel de 2.000 perde o BEGIN e as primeiras linhas do corpo; o END e o resto do corpo ficam
    const corpo = CHAVE(40);
    const m = montar({ scripts: { deploy: imprimir(['-----BEGIN RSA PRIVATE KEY-----', ...corpo, '-----END RSA PRIVATE KEY-----', 'depois']) } });
    const { rc, json, stdout } = rodar(m, 'executar');
    assert.equal(rc, 0, JSON.stringify(json));
    const saida = json.etapas[0].saida;
    assert.ok(saida.endsWith('\n[redigido]\ndepois\n'), saida.slice(-60));
    assert.equal(saida.includes('CORPO'), false);
    assert.equal(saida.includes('-----END'), false);
    assert.equal(stdout.includes('CORPO'), false);
    assert.equal(textoDoDiario(m).includes('CORPO'), false);
  });

  test('chave-pem-sem-end-redigida-ate-o-fim', () => {
    const m = montar({ scripts: { deploy: imprimir(['antes', '-----BEGIN PRIVATE KEY-----', ...CHAVE(3)]) } });
    const { json } = rodar(m, 'executar');
    assert.equal(json.etapas[0].saida, `antes\n${'[redigido]\n'.repeat(4)}`);
  });

  test('chave-pem-nao-redige-o-que-vem-depois-do-end', () => {
    const m = montar({ scripts: { deploy: imprimir(['-----BEGIN PRIVATE KEY-----', ...CHAVE(2), '-----END PRIVATE KEY-----', 'visivel-1', 'visivel-2']) } });
    const { json } = rodar(m, 'executar');
    assert.equal(json.etapas[0].saida, `${'[redigido]\n'.repeat(4)}visivel-1\nvisivel-2\n`);
  });
});

describe('r3: âncora do entrega.inicio contra a cauda apagada', { concurrency: 4 }, () => {
  const ANCORA = 'entrega.ancora';
  const sha256 = (t) => createHash('sha256').update(t).digest('hex');
  const arqDiario = (m, sessao = 'loop') => join(m.dir, `events.${sessao}.jsonl`);
  const linhas = (m, sessao = 'loop') => readFileSync(arqDiario(m, sessao), 'utf8').split('\n').filter(Boolean);
  const gravarLinhas = (m, ls) => writeFileSync(arqDiario(m), `${ls.join('\n')}\n`);
  const limparMarcas = (m) => { for (const n of ['deploy', 'smoke', 'rollback', 'exec.log']) if (existsSync(join(m.marcas, n))) unlinkSync(join(m.marcas, n)); };
  const semEfeito = (m, antes, json, erro) => {
    assert.equal(json.ok, false);
    assert.equal(json.erro, erro);
    assert.equal(execLog(m).length, 0, 'nenhum comando rodou');
    assert.equal(marca(m, 'deploy'), false, 'o deploy não rodou');
    assert.equal(eventos(m).length, antes, 'nada foi gravado');
  };
  /** O estado que a morte do orquestrador deixa: o diário termina em `producao.acesso, entrega.inicio`, com a âncora gravada pelo `executar` real. */
  const inicioSemFim = async (m) => {
    const r = await executarEntrega(m.repo, { entrega: ENTREGA, append: appendQueFalha((e) => e.tipo !== 'producao.acesso' && e.tipo !== 'entrega.inicio') });
    assert.equal(r.erro, 'evento_nao_gravado', 'preparo: smoke, fim e o resto não foram gravados');
    assert.deepEqual(eventos(m).slice(-2).map((e) => e.tipo), ['producao.acesso', 'entrega.inicio']);
    limparMarcas(m);
  };

  test('cauda-apagada-com-inicio-nao-roda-deploy', async () => {
    const m = montar();
    await inicioSemFim(m);
    const antes = eventos(m).length;
    const intacto = rodar(m, 'executar');
    semEfeito(m, antes, intacto.json, 'nao_subiu');
    assert.deepEqual(intacto.json.decisao, { tipo: 'parar', motivo: 'nao_conseguiu' });
    gravarLinhas(m, linhas(m).slice(0, -2));
    const depois = eventos(m).length;
    assert.equal(depois, antes - 2);
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    semEfeito(m, depois, json, 'diario_ilegivel');
    assert.match(json.mensagem, /a âncora aponta para o entrega\.inicio loop\/\d+, que não está no diário: cauda apagada ou diário trocado; nada foi feito/);
    const d = rodar(m, 'decidir');
    assert.equal(d.json.erro, 'diario_ilegivel', 'a decisão também confere a âncora');
  });

  test('diario-restaurado-a-prefixo-nao-roda-deploy', () => {
    const m = montar();
    const copia = readFileSync(arqDiario(m), 'utf8');
    const ok = rodar(m, 'executar');
    assert.equal(ok.rc, 0, JSON.stringify(ok.json));
    assert.equal(execLog(m).length, 2);
    writeFileSync(arqDiario(m), copia);
    limparMarcas(m);
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    semEfeito(m, antes, json, 'diario_ilegivel');
  });

  test('ancora-hash-diferente-no-mesmo-seq-e-ilegivel', async () => {
    // a cadeia continua válida (a linha trocada é a última), com o mesmo seq e conteúdo diferente: só o hash da âncora pega
    const m = montar();
    await inicioSemFim(m);
    const ls = linhas(m);
    const ultima = JSON.parse(ls.at(-1));
    gravarLinhas(m, [...ls.slice(0, -1), JSON.stringify({ ...ultima, ts: '2000-01-01T00:00:00.000Z' })]);
    const antes = eventos(m).length;
    const { json } = rodar(m, 'executar');
    semEfeito(m, antes, json, 'diario_ilegivel');
  });

  test('ancora-nao-gravada-nao-roda-deploy', async () => {
    const m = montar();
    mkdirSync(join(m.dir, 'entrega.ancora.tmp')); // o tmp da escrita atômica é uma pasta: a escrita falha de verdade
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    assert.equal(json.ok, false);
    assert.equal(json.erro, 'ancora_nao_gravada');
    assert.equal(execLog(m).length, 0, 'nenhum comando rodou');
    assert.equal(marca(m, 'deploy'), false);
    assert.equal(existsSync(join(m.dir, ANCORA)), false, 'nenhuma âncora');
    assert.equal(existsSync(join(m.dir, 'entrega.lock')), false, 'o lock foi solto');
    assert.deepEqual(tiposDesde(m, antes), ['producao.acesso', 'entrega.inicio'], 'o inicio fica sem fim');
    const d = rodar(m, 'decidir');
    assert.deepEqual(d.json.decisao, { tipo: 'parar', motivo: 'nao_conseguiu' });
  });

  test('ancora-gravada-antes-do-deploy', () => {
    const alvo = '$M/../repo com espaço/.harness/entregas/GM-10/entrega.ancora';
    const m = montar({ scripts: { deploy: `[ -s "${alvo}" ] && touch "$M/ancora-existia"\necho ola-deploy\ntouch "$M/deploy"` } });
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 0, JSON.stringify(json));
    assert.equal(marca(m, 'ancora-existia'), true, 'a âncora já existia quando o deploy rodou');
  });

  test('ancora-grava-sessao-seq-e-hash-do-inicio', () => {
    const m = montar();
    const { rc } = rodar(m, 'executar', ['--sessao', 's2']);
    assert.equal(rc, 0);
    const ancora = JSON.parse(readFileSync(join(m.dir, ANCORA), 'utf8'));
    assert.deepEqual(Object.keys(ancora).sort(), ['hash', 'seq', 'sessao']);
    assert.equal(ancora.sessao, 's2');
    const linha = linhas(m, 's2').find((l) => JSON.parse(l).seq === ancora.seq);
    assert.equal(JSON.parse(linha).tipo, 'entrega.inicio');
    assert.equal(ancora.hash, sha256(linha));
    assert.equal(readdirSync(m.dir).includes('entrega.ancora.tmp'), false, 'o tmp foi renomeado');
    // âncora intacta não barra nada: a decisão seguinte é `entregue`
    const de = rodar(m, 'decidir');
    assert.deepEqual(de.json.decisao, { tipo: 'entregue' });
    const ex = rodar(m, 'executar');
    assert.equal(ex.rc, 0);
    assert.deepEqual(ex.json.decisao, { tipo: 'entregue' });
  });

  test('ancora-sobrescreve-a-anterior-na-nova-tentativa', () => {
    const m = montar({ tasks: ['T1', 'T2', 'T3'], integradas: ['T1', 'T2'] });
    ev(m, 'entrega.inicio', { politica: 'continua' });
    ev(m, 'entrega.smoke', { ok: false });
    ev(m, 'entrega.rollback', { ok: true });
    ev(m, 'entrega.fim', { ok: false, motivo: 'smoke' });
    ev(m, 'loop.parar', { motivo: 'smoke' });
    integrar(m, 'T3');
    fechar(m);
    ev(m, 'ci.resultado', { verde: true, alvo: 'homolog' });
    const { rc } = rodar(m, 'executar');
    assert.equal(rc, 0);
    const ancora = JSON.parse(readFileSync(join(m.dir, ANCORA), 'utf8'));
    const iniciosNoDiario = linhas(m).filter((l) => JSON.parse(l).tipo === 'entrega.inicio');
    assert.equal(iniciosNoDiario.length, 2);
    assert.equal(ancora.hash, sha256(iniciosNoDiario[1]), 'a âncora é a do ÚLTIMO inicio');
    assert.equal(ancora.seq, JSON.parse(iniciosNoDiario[1]).seq);
  });

  test('diario-primeira-linha-apagada', () => {
    // MINOR-3 da r2: a guarda de hash vale para a 1ª linha do arquivo também (a linha 2 aponta para o hash da 1ª)
    const m = montar();
    gravarLinhas(m, linhas(m).slice(1));
    const antes = eventos(m).length;
    const { rc, json } = rodar(m, 'executar');
    assert.equal(rc, 1);
    semEfeito(m, antes, json, 'diario_ilegivel');
    assert.match(json.mensagem, /linha 1: cadeia de hash quebrada/);
  });

  describe('âncora inválida é ilegível; ausente sobe', () => {
    const invalida = (nome, preparar, mensagem) => test(`ancora-corrompida-${nome}`, async () => {
      const m = montar();
      await preparar(m);
      const antes = eventos(m).length;
      const { rc, json } = rodar(m, 'executar');
      assert.equal(rc, 1);
      semEfeito(m, antes, json, 'diario_ilegivel');
      assert.match(json.mensagem, mensagem);
      assert.equal(rodar(m, 'decidir').json.erro, 'diario_ilegivel');
    });
    const escrever = (conteudo) => (m) => writeFileSync(join(m.dir, ANCORA), typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo));
    const FORMA = /fora da forma \{sessao, seq, hash\}/;
    invalida('array', escrever('[]'), FORMA);
    invalida('nao-json', escrever('lixo'), /não é JSON/);
    invalida('objeto-vazio', escrever({}), FORMA);
    invalida('seq-nao-inteiro', escrever({ sessao: 'loop', seq: '1', hash: 'a'.repeat(64) }), FORMA);
    invalida('sessao-fora-da-forma', escrever({ sessao: '../x', seq: 1, hash: 'a'.repeat(64) }), FORMA);
    invalida('hash-curto', escrever({ sessao: 'loop', seq: 1, hash: 'abc' }), FORMA);
    invalida('symlink-para-ancora-valida', async (m) => {
      // o alvo é uma âncora VÁLIDA do diário: só a checagem de arquivo regular a recusa
      await inicioSemFim(m);
      const alvo = join(m.base, 'alvo.json');
      renameSync(join(m.dir, ANCORA), alvo);
      symlinkSync(alvo, join(m.dir, ANCORA));
    }, /entrega\.ancora não é arquivo regular/);
    invalida('pasta', (m) => mkdirSync(join(m.dir, ANCORA)), /entrega\.ancora não é arquivo regular/);

    // cada campo é lido: trocar um por outro valor plausível derruba a conferência
    const ancoraReal = () => {
      const m = montar();
      assert.equal(rodar(m, 'executar').rc, 0);
      return { m, a: JSON.parse(readFileSync(join(m.dir, ANCORA), 'utf8')) };
    };
    const flip = (h) => `${h[0] === 'a' ? 'b' : 'a'}${h.slice(1)}`;
    for (const [campo, troca] of [['seq', (a) => ({ ...a, seq: a.seq + 1 })], ['hash', (a) => ({ ...a, hash: flip(a.hash) })], ['sessao', (a) => ({ ...a, sessao: 'outra' })]]) {
      test(`ancora-campo-${campo}-trocado-e-ilegivel`, () => {
        const { m, a } = ancoraReal();
        writeFileSync(join(m.dir, ANCORA), JSON.stringify(troca(a)));
        limparMarcas(m);
        const { rc, json } = rodar(m, 'executar');
        assert.equal(rc, 1);
        assert.equal(json.erro, 'diario_ilegivel');
        assert.match(json.mensagem, /que não está no diário/);
        assert.equal(execLog(m).length, 0);
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────── E4 T7: devolver, prepararLeitura, decisaoDe

/** sha256 de TODO o conteúdo de uma pasta (nomes e bytes), em ordem estável: o que "nada foi escrito" quer dizer. */
function hashDaPasta(dir) {
  const h = createHash('sha256');
  const anda = (d) => {
    for (const n of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(d, n.name);
      h.update(`${p.slice(dir.length)}\0${n.isDirectory() ? 'D' : 'F'}\0`);
      if (n.isDirectory()) anda(p); else h.update(readFileSync(p));
    }
  };
  anda(dir);
  return h.digest('hex');
}
const hashHarness = (m) => hashDaPasta(join(m.repo, '.harness'));
const lockDe = (m) => join(m.dir, 'entrega.lock');
const devolver = (m, motivo, extra = [], opts) => rodar(m, 'devolver', ['--motivo', motivo, ...extra], opts);
/** Janela UTC de 1 h que não contém o agora (a 4 h ou mais): `agendar` com `quando` inédito, sem depender da hora da máquina. */
function janelaFechada() {
  const h = new Date().getUTCHours();
  const hh = String(h <= 15 ? h + 4 : h - 6).padStart(2, '0');
  const fim = String(Number(hh) + 1).padStart(2, '0');
  return { dias: [0, 1, 2, 3, 4, 5, 6], inicio: `${hh}:00`, fim: `${fim}:00`, fuso: 'UTC' };
}
/** Evento com `ts` escolhido (relógio de outra sessão). */
function evEm(m, sessao, ts, tipo, dados) {
  const r = diario.append(m.dir, sessao, { ts, autor: 't', sessao, agente: 'orquestrador', tipo, dados });
  assert.equal(r.ok, true, `preparo: ${tipo}: ${r.erro}`);
}

describe('E4 T7: entrega devolver', { concurrency: 4 }, () => {
  test('devolver-grava-motivo: o evento tem só {motivo}, lido pelo valor; a saída traz o mesmo', () => {
    const m = montar();
    const antes = eventos(m).length;
    const motivo = 'revisão: "não deu" ç';
    const { rc, json } = devolver(m, motivo);
    assert.equal(rc, 0, JSON.stringify(json));
    assert.deepEqual(json, { ok: true, gravado: true, evento: { tipo: 'entrega.devolvida', motivo } });
    const novos = eventos(m).slice(antes);
    assert.equal(novos.length, 1);
    assert.equal(novos[0].tipo, 'entrega.devolvida');
    assert.deepEqual(novos[0].dados, { motivo });
    assert.equal(novos[0].agente, 'orquestrador');
  });

  test('devolver-sem-comando-no-diario: a sentinela do argv de deploy não entra no diário e nada roda', () => {
    const m = montar({ extraArgv: [SENTINELA] });
    const { rc } = devolver(m, 'npm run deploy');
    assert.equal(rc, 0);
    assert.ok(!textoDoDiario(m).includes(SENTINELA));
    assert.ok(textoDoDiario(m).includes('npm run deploy'), 'o diário só tem o texto passado');
    assert.deepEqual(execLog(m), [], 'nenhum comando de entrega rodou');
    assert.equal(marca(m, 'deploy'), false);
    assert.equal(Object.hasOwn(eventos(m).at(-1).dados, 'comando'), false);
  });

  test('devolver-motivo-ausente-uso-rc2: sem --motivo, flag sem valor, posicional, e --motivo em decidir/executar', () => {
    const m = montar();
    const h = hashHarness(m);
    for (const argv of [['devolver'], ['devolver', '--motivo'], ['devolver', 'solto'], ['devolver', '--motivo', 'a', '--motivo', 'b'], ['devolver', '--nada', 'x'], ['decidir', '--motivo', 'a'], ['executar', '--motivo', 'a']]) {
      const r = spawnSync(process.execPath, [SCRIPT, ...argv, '--entrega', ENTREGA], { cwd: m.repo, encoding: 'utf8' });
      const j = JSON.parse(r.stdout.trim());
      assert.equal(r.status, 2, argv.join(' '));
      assert.equal(j.erro, 'uso', argv.join(' '));
    }
    assert.equal(hashHarness(m), h);
  });

  test('devolver-forma-de-entrega-e-sessao: recusadas antes de tudo, rc 1', () => {
    const m = montar();
    const h = hashHarness(m);
    assert.equal(devolver(m, 'x', [], { entrega: 'gm 1' }).json.erro, 'entrega_invalida');
    const s = devolver(m, 'x', ['--sessao', 'a b']);
    assert.equal(s.json.erro, 'argumento_invalido');
    assert.equal(s.rc, 1);
    assert.equal(hashHarness(m), h);
  });

  test('devolver-motivo-espacos-vazio: vazio e só espaços ⇒ motivo_vazio, nada gravado', () => {
    const m = montar();
    const h = hashHarness(m);
    for (const motivo of ['', '   ', ' \u00a0 ']) {
      const { rc, json } = devolver(m, motivo);
      assert.equal(rc, 1, JSON.stringify(motivo));
      assert.equal(json.erro, 'motivo_vazio', JSON.stringify(motivo));
    }
    assert.equal(hashHarness(m), h);
  });

  test('devolver-200-code-points-com-emoji-aceito: a régua é code point, a mesma de formas.ts; 201 recusa', () => {
    const m = montar();
    const emoji = '\u{1F600}'.repeat(200);
    assert.equal(emoji.length, 400);
    const ok = devolver(m, emoji);
    assert.equal(ok.rc, 0, JSON.stringify(ok.json));
    assert.equal(eventos(m).at(-1).dados.motivo, emoji);
    const h = hashHarness(m);
    const longo = devolver(m, `${emoji}\u{1F600}`);
    assert.equal(longo.rc, 1);
    assert.equal(longo.json.erro, 'motivo_longo');
    const a201 = devolver(m, 'a'.repeat(201));
    assert.equal(a201.json.erro, 'motivo_longo');
    assert.equal(devolver(m, 'a'.repeat(200)).rc, 0);
    assert.equal(hashHarness(m) === h, false, 'o de 200 caracteres foi gravado');
  });

  test('devolver-controle-recusado: quebra de linha, tab e BEL ⇒ motivo_invalido, nada gravado', () => {
    const m = montar();
    const h = hashHarness(m);
    for (const motivo of ['a\nb', 'a\tb', 'a\u0007b', 'a\rb']) {
      const { rc, json } = devolver(m, motivo);
      assert.equal(rc, 1, JSON.stringify(motivo));
      assert.equal(json.erro, 'motivo_invalido', JSON.stringify(motivo));
    }
    assert.equal(hashHarness(m), h);
  });

  test('devolver-canario-zero-bytes: motivo com segredo ⇒ motivo_recusado e 0 bytes (nem diario.recusa)', () => {
    const m = montar();
    const h = hashHarness(m);
    for (const motivo of [token(), `AKIA${'A'.repeat(16)}`, `chave ${token()} no meio`]) {
      const { rc, json } = devolver(m, motivo);
      assert.equal(rc, 1);
      assert.equal(json.erro, 'motivo_recusado');
      assert.ok(!JSON.stringify(json).includes(token()), 'o segredo não volta na saída');
    }
    assert.equal(hashHarness(m), h);
    assert.ok(!eventos(m).some((e) => e.tipo === 'diario.recusa'));
  });

  test('devolver-ordem-motivo-antes-do-lock: lock presente e motivo vazio ⇒ motivo_vazio (a recusa mais barata vem antes)', () => {
    const m = montar();
    writeFileSync(lockDe(m), `${process.pid} x\n`);
    assert.equal(devolver(m, '').json.erro, 'motivo_vazio');
    assert.equal(devolver(m, 'a\nb').json.erro, 'motivo_invalido');
  });

  test('devolver-nao-subiu-nada-gravado: decisão `agendar` (janela fechada) e `esperar` não viram botão', () => {
    const fechada = montar({ politica: 'janela', janela: janelaFechada() });
    const h = hashHarness(fechada);
    const r = devolver(fechada, 'subir agora');
    assert.equal(r.rc, 1);
    assert.equal(r.json.erro, 'nao_subiu');
    assert.equal(r.json.decisao.tipo, 'agendar');
    assert.equal(hashHarness(fechada), h, 'nem entrega.agendada nem devolvida');
    assert.ok(!eventos(fechada).some((e) => e.tipo === 'entrega.agendada' || e.tipo === 'entrega.devolvida'));
    const espera = montar({ homolog: null });
    const e = devolver(espera, 'x');
    assert.equal(e.json.erro, 'nao_subiu');
    assert.equal(e.json.decisao.tipo, 'esperar');
    const pr = montar({ politica: 'sob_demanda' });
    const p = devolver(pr, 'x');
    assert.equal(p.json.erro, 'nao_subiu');
    assert.equal(p.json.decisao.tipo, 'release_pr');
  });

  test('devolver-entrega-incompleta: loop fora de `concluir` ⇒ entrega_incompleta, nada gravado', () => {
    const m = montar({ integradas: ['T1'] });
    const h = hashHarness(m);
    const r = devolver(m, 'x');
    assert.equal(r.rc, 1);
    assert.equal(r.json.erro, 'entrega_incompleta');
    assert.equal(hashHarness(m), h);
  });

  test('devolver-plano-ausente-x-invalido: dois casos, dois códigos; nunca sem_plano', () => {
    const a = montar();
    unlinkSync(join(a.dir, 'plano.json'));
    const ha = hashHarness(a);
    assert.equal(devolver(a, 'x').json.erro, 'plano_ausente');
    assert.equal(hashHarness(a), ha);
    const b = montar();
    writeFileSync(join(b.dir, 'plano.json'), '{');
    const hb = hashHarness(b);
    assert.equal(devolver(b, 'x').json.erro, 'plano_invalido');
    assert.equal(hashHarness(b), hb);
  });

  test('devolver-diario-ilegivel-e-pausado: erros de preparar passam com o código deles, nada gravado', () => {
    const m = montar();
    appendFileSync(join(m.dir, 'events.loop.jsonl'), 'lixo\n');
    const h = hashHarness(m);
    assert.equal(devolver(m, 'x').json.erro, 'diario_ilegivel');
    assert.equal(hashHarness(m), h);
    const p = montar();
    mkdirSync(join(p.repo, '.harness'), { recursive: true });
    writeFileSync(join(p.repo, '.harness', 'PAUSAR'), '');
    assert.equal(devolver(p, 'x').json.erro, 'pausado');
  });

  test('devolver-lock-em-curso: lock presente ⇒ entrega_em_curso, o lock alheio fica, nada gravado', () => {
    const m = montar();
    writeFileSync(lockDe(m), `${process.pid} x\n`);
    const h = hashHarness(m);
    const r = devolver(m, 'x');
    assert.equal(r.rc, 1);
    assert.equal(r.json.erro, 'entrega_em_curso');
    assert.equal(existsSync(lockDe(m)), true, 'o lock que não é meu não é solto');
    assert.equal(hashHarness(m), h);
    // o lock vem antes das pré-condições do preparar: com a entrega incompleta, a causa é o lock
    const inc = montar({ integradas: ['T1'] });
    writeFileSync(lockDe(inc), `${process.pid} x\n`);
    assert.equal(devolver(inc, 'x').json.erro, 'entrega_em_curso');
  });

  test('devolver-solta-lock: em sucesso e em recusa depois do lock, o lock some', () => {
    const m = montar();
    assert.equal(devolver(m, 'um').rc, 0);
    assert.equal(existsSync(lockDe(m)), false);
    const n = montar({ homolog: null });
    assert.equal(devolver(n, 'x').json.erro, 'nao_subiu');
    assert.equal(existsSync(lockDe(n)), false);
    const k = montar({ integradas: ['T1'] });
    assert.equal(devolver(k, 'x').json.erro, 'entrega_incompleta');
    assert.equal(existsSync(lockDe(k)), false);
  });

  test('devolver-idempotente-mesmo-motivo: 2ª vez ok sem gravar; outro motivo grava; A, B, A grava o A de novo', () => {
    const m = montar();
    const n0 = eventos(m).length;
    assert.equal(devolver(m, 'A').json.gravado, true);
    const h = hashHarness(m);
    const segunda = devolver(m, 'A');
    assert.equal(segunda.rc, 0);
    assert.deepEqual(segunda.json, { ok: true, gravado: false });
    assert.equal(hashHarness(m), h);
    assert.equal(eventos(m).length, n0 + 1);
    assert.equal(devolver(m, 'B').json.gravado, true);
    const terceira = devolver(m, 'A');
    assert.equal(terceira.json.gravado, true, 'o último vigente é B: o A de novo é outro pedido');
    assert.deepEqual(eventos(m).slice(n0).map((e) => e.dados.motivo), ['A', 'B', 'A']);
  });

  test('devolver-nao-confere-checkout: árvore rastreada suja não impede (só `executar` confere)', () => {
    const m = montar();
    appendFileSync(join(m.repo, 'README.md'), 'sujo\n');
    const r = devolver(m, 'x');
    assert.equal(r.rc, 0, JSON.stringify(r.json));
    assert.equal(executarEntregaSujo(m), 'checkout_sujo', 'o mesmo checkout impede o executar: o teste distingue');
  });
  function executarEntregaSujo(m) {
    const r = rodar(m, 'executar');
    return r.json.erro;
  }

  test('devolver-relogio-do-diario: um entrega.inicio com relógio à frente põe o candidato antes dele ⇒ relogio_do_diario, nada gravado', () => {
    const m = montar({ integradas: [], homolog: null });
    const F = (n) => new Date(Date.UTC(2099, 0, 1, 0, 0, n)).toISOString();
    let n = 0;
    const e = (tipo, dados) => evEm(m, 'outra', F(++n), tipo, dados);
    for (const task of ['T1']) {
      e('task.iniciada', { task, papel: 'implementador' });
      e('task.concluida', { task, sha: 'a'.repeat(40) });
      e('review.veredito', { task, veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 });
      e('task.integrada', { task, sha: 'b'.repeat(40) });
    }
    e('entrega.inicio', { politica: 'continua' });
    e('entrega.fim', { ok: true });
    e('task.iniciada', { task: 'T2', papel: 'implementador' });
    e('task.concluida', { task: 'T2', sha: 'a'.repeat(40) });
    e('review.veredito', { task: 'T2', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 });
    e('task.integrada', { task: 'T2', sha: 'b'.repeat(40) });
    fechar(m);
    e('ci.resultado', { verde: true, alvo: 'homolog' });
    const d = decidirAgora(m.repo, { entrega: ENTREGA, agoraMs: Date.now() });
    assert.deepEqual(d.decisao, { tipo: 'subir' }, 'o preparo chega a `subir`; só o relógio impede');
    const h = hashHarness(m);
    const r = devolver(m, 'x');
    assert.equal(r.rc, 1);
    assert.equal(r.json.erro, 'relogio_do_diario');
    assert.equal(hashHarness(m), h);
  });
});

describe('E4 T7: prepararLeitura e decisaoDe', { concurrency: 4 }, () => {
  const ler = (m, extra = {}) => prepararLeitura(m.repo, { entrega: ENTREGA, agoraMs: Date.now(), ...extra });

  test('decisao-de-exportada-nao-grava: janela fechada e `quando` inédito ⇒ agendar, sem lock, sem entrega.agendada, `.harness/` igual', () => {
    const m = montar({ politica: 'janela', janela: janelaFechada() });
    const h = hashHarness(m);
    const r = ler(m);
    assert.equal(r.ok, true, JSON.stringify(r));
    const d = decisaoDe(r.p);
    assert.equal(d.tipo, 'agendar');
    assert.equal(typeof d.quando, 'string');
    assert.equal(hashHarness(m), h, 'nenhum byte em .harness/');
    assert.equal(existsSync(lockDe(m)), false);
    assert.ok(!eventos(m).some((e) => e.tipo === 'entrega.agendada'));
    // o contraste: `decidirAgora` grava a agendada nesse mesmo cenário, então o hash acima distingue
    assert.equal(decidirAgora(m.repo, { entrega: ENTREGA }).decisao.tipo, 'agendar');
    assert.notEqual(hashHarness(m), h);
  });

  test('preparar-leitura-ignora-pausa: PAUSAR não decide nada aqui, a decisão segue; `decidirAgora` continua recusando', () => {
    const m = montar();
    mkdirSync(join(m.repo, '.harness'), { recursive: true });
    writeFileSync(join(m.repo, '.harness', 'PAUSAR'), '');
    const r = ler(m);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(decisaoDe(r.p), { tipo: 'subir' });
    assert.equal(decidirAgora(m.repo, { entrega: ENTREGA }).erro, 'pausado');
  });

  test('preparar-leitura-lock-pid-vivo-em-curso: inicio sem fim + lock do processo vivo ⇒ entrega_em_curso (e não PAROU)', () => {
    const m = montar();
    ev(m, 'entrega.inicio', { politica: 'continua' });
    writeFileSync(lockDe(m), `${process.pid} ${new Date().toISOString()}\n`);
    const h = hashHarness(m);
    const r = ler(m);
    assert.equal(r.ok, false);
    assert.equal(r.erro, 'entrega_em_curso');
    assert.equal(typeof r.mensagem, 'string');
    assert.equal(hashHarness(m), h, 'o lock alheio não é tocado');
    // EPERM também é vivo (pid 1 não é do usuário); sem erro (root) também
    writeFileSync(lockDe(m), '1 x\n');
    assert.equal(ler(m).erro, 'entrega_em_curso');
  });

  test('preparar-leitura-lock-orfao-decide: pid morto, sem pid, vazio e ilegível seguem para a decisão (PAROU nao_conseguiu é a verdade)', () => {
    const m = montar();
    ev(m, 'entrega.inicio', { politica: 'continua' });
    const morto = spawnSync(process.execPath, ['-e', '']).pid;
    for (const corpo of [`${morto} x\n`, 'sem-pid\n', '', '\u0000\u0001', '-5 x\n', '0 x\n']) {
      writeFileSync(lockDe(m), corpo);
      const r = ler(m);
      assert.equal(r.ok, true, `${JSON.stringify(corpo)}: ${JSON.stringify(r)}`);
      assert.deepEqual(decisaoDe(r.p), { tipo: 'parar', motivo: 'nao_conseguiu' }, JSON.stringify(corpo));
    }
  });

  test('preparar-leitura-lock-ilegivel-e-pasta: um `entrega.lock` que é diretório também segue para a decisão', () => {
    const m = montar();
    mkdirSync(lockDe(m));
    const r = ler(m);
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  test('preparar-leitura-diario-ilegivel-nao-lanca: cadeia quebrada ⇒ {ok:false, erro:diario_ilegivel}', () => {
    const m = montar();
    appendFileSync(join(m.dir, 'events.loop.jsonl'), 'lixo\n');
    const r = ler(m);
    assert.equal(r.ok, false);
    assert.equal(r.erro, 'diario_ilegivel');
    assert.equal(typeof r.mensagem, 'string');
  });

  test('preparar-leitura-ausente-x-corrompido: plano ausente, plano torto, entrega incompleta, forma e fora de repo: sempre {ok:false}, sem lançar', () => {
    const a = montar();
    unlinkSync(join(a.dir, 'plano.json'));
    assert.equal(ler(a).erro, 'plano_ausente');
    const b = montar();
    writeFileSync(join(b.dir, 'plano.json'), '{');
    assert.equal(ler(b).erro, 'plano_invalido');
    const c = montar({ integradas: ['T1'] });
    const rc = ler(c);
    assert.equal(rc.ok, false);
    assert.equal(rc.erro, 'entrega_incompleta');
    assert.equal(ler(montar(), { entrega: 'gm 1' }).erro, 'entrega_invalida');
    const fora = realpathSync(mkdtempSync(join(tmpdir(), 'fora-de-repo ')));
    assert.equal(prepararLeitura(fora, { entrega: ENTREGA }).erro, 'fora_de_repo');
  });

  test('preparar-leitura-sem-diario-e-integracao: pasta sem diário ⇒ entrega_incompleta (ausente), não diario_ilegivel', () => {
    const m = montar({ integradas: [], homolog: null });
    const r = ler(m);
    assert.equal(r.erro, 'entrega_incompleta');
  });

  test('preparar-leitura-p-igual-ao-de-preparar: o `p` entrega política, eventos e plano que a decisão usa', () => {
    const m = montar();
    const r = ler(m, { agoraMs: 12345 });
    assert.equal(r.p.agoraMs, 12345);
    assert.equal(r.p.efetiva.politica, 'continua');
    assert.equal(r.p.eventos.length, eventos(m).length);
    assert.equal(r.p.plano.entrega, ENTREGA);
  });
});

// ---- GM-13 FX8 (REQ-ENT-1): só `entrega.base` cai para o config commitado no HEAD; o resto governa o deploy e fica só em origin.
describe('base da entrega com fallback do HEAD (FX8)', () => {
  const decidir = (m) => rodar(m, 'decidir').json;

  test('t1: origin sem entrega, HEAD com base staging ⇒ release_pr staging + aviso', () => {
    const j = decidir(montar({ origem: {}, local: { entrega: { base: 'staging' } } }));
    assert.deepEqual(j.decisao, { tipo: 'release_pr', base: 'staging' });
    assert.match(j.aviso, /base do HEAD: origin\/HEAD sem entrega\.base/);
  });

  test('t2: origin main, HEAD staging ⇒ origin vence, aviso cita as duas', () => {
    const j = decidir(montar({ origem: { entrega: { base: 'main' } }, local: { entrega: { base: 'staging' } } }));
    assert.deepEqual(j.decisao, { tipo: 'release_pr', base: 'main' });
    assert.match(j.aviso, /main/);
    assert.match(j.aviso, /staging/);
    assert.match(j.aviso, /diverg/);
  });

  test('t3: HEAD sem base e worktree com base x não commitada ⇒ main (lê o objeto commitado)', () => {
    const m = montar({ origem: {}, local: { entrega: { politica: 'sob_demanda' } } });
    writeFileSync(join(m.repo, 'harness.config.json'), JSON.stringify({ entrega: { base: 'x' } }));
    const j = decidir(m);
    assert.deepEqual(j.decisao, { tipo: 'release_pr', base: 'main' });
    assert.match(j.aviso, /nenhuma base declarada/);
  });

  test('t4: política e comandos do HEAD não valem; origin sem entrega segue release_pr sob_demanda', () => {
    const cmds = { deploy: { argv: ['bash', '-c', 'true'], timeout_s: 5 } };
    const j = decidir(montar({ origem: {}, local: { entrega: { politica: 'continua', autonomia: true, base: 'staging', comandos: cmds } } }));
    assert.equal(j.decisao.tipo, 'release_pr');
    assert.equal(j.politica, 'sob_demanda');
    assert.equal(j.decisao.base, 'staging');
    assert.equal(j.decisao.aviso, undefined, 'sem aviso de comandos ausentes só se vier de origin');
  });

  test('t5: base inválida no HEAD ⇒ main + aviso', () => {
    for (const ruim of ['../x', 'a..b', '-rf', 'a b', 7]) {
      const j = decidir(montar({ origem: {}, local: { entrega: { base: ruim } } }));
      assert.deepEqual(j.decisao, { tipo: 'release_pr', base: 'main' }, String(ruim));
      assert.match(j.aviso, /entrega\.base.*inv/, String(ruim));
    }
  });
});

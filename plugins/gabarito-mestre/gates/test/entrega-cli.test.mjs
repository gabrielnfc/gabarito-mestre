/**
 * REQ-ENT-1/ENT-2 pela borda: `entrega.mjs` (decidir, executar). Nada de deploy real: cada caso monta um repositório descartável
 * (`mkdtemp`, com ESPAÇO no caminho) com `origin` bare local e scripts falsos que só gravam marcadores sob o mesmo diretório.
 * O relógio entra por `agoraMs` (em processo) ou não entra (CLI: `continua`); falha de `append` entra por `opts.append`.
 *
 * MUTAÇÕES PRESCRITAS: task-8-mut.json da entrega.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, realpathSync, appendFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import * as diario from '../dist/diario.js';
import { decidirEntrega } from '../dist/entrega.js';
import { decidirAgora, executarEntrega, rcDe } from '../scripts/entrega.mjs';

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
  politica = 'continua', janela, origem, semOrigin = false, local, scripts = {}, timeouts = {}, extraArgv = [], deployArgv, comandos = ['deploy', 'smoke', 'rollback'],
  tasks = PLANO_PADRAO, integradas = tasks, homolog = true, planoExtra = {},
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
  const entrega = { politica, base: 'main', comandos: cmds, ...(janela ? { janela } : {}) };
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
  if (homolog !== null) ev(m, 'ci.resultado', { verde: homolog, alvo: 'homolog' });
  return m;
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

  test('inicio-orfao-antigo-ainda-para-mesmo-com-integracao-nova', () => {
    const m = montar({ tasks: ['T1', 'T2', 'T3'], integradas: ['T1', 'T2'] });
    ev(m, 'entrega.inicio', { politica: 'continua' });
    integrar(m, 'T3');
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

  test('sem-origin-sob-demanda', () => {
    const m = montar({ semOrigin: true });
    const dec = rodar(m, 'decidir');
    assert.equal(dec.rc, 0);
    assert.deepEqual(dec.json.decisao, { tipo: 'release_pr', base: 'main' });
    assert.equal(dec.json.politica, 'sob_demanda');
    assert.equal('aviso' in dec.json, false, 'ausente não é corrompido: sem aviso');
    assert.equal(rodar(m, 'executar').json.erro, 'nao_subiu');
  });
});

describe('ausente x corrompido', { concurrency: 4 }, () => {
  test('config-ausente-x-corrompida', () => {
    // 1) origin sem o arquivo; 2) JSON inválido; 3) `entrega` de forma errada; 4) raiz que não é objeto: quatro saídas, nenhuma sucesso
    const semArquivo = rodar(montar({ origem: false }), 'decidir').json;
    assert.deepEqual(semArquivo.decisao, { tipo: 'release_pr', base: 'main' });
    assert.equal('aviso' in semArquivo, false);
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
    const dec = rodar(m, 'decidir');
    assert.deepEqual(dec.json.decisao, { tipo: 'parar', motivo: 'smoke' });
    assert.equal(rodar(m, 'executar').json.erro, 'nao_subiu');
    assert.equal(execLog(m).length, 3, 'deploy, smoke e rollback: nada roda de novo');
  });
});

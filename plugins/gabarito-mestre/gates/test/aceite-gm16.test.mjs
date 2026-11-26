/**
 * GM-16 T6: o ACEITE da visão de projeto num repositório grande SINTÉTICO (spec "Aceite", emendas 2 a 5), pelo adaptador REAL `scripts/painel.mjs`
 * (aprendizado 143) e pelo CLI REAL do doctor, num repo git descartável. Nada vem de outro projeto: o gerador (fixtures/gm16-repo-grande/gerador.mjs)
 * inventa nomes e IDs e só reproduz a FORMA medida no S1 (planos) e no S2 (cards).
 *
 * Desenho para custo (aprendizado: e2e caro sobre dados gerados, parada cedo): o repo é gerado UMA vez (91 cards, 38 planos, 28 commits de PBI), um teste
 * valida a fixture e os demais só leem; cada modo roda o adaptador 2 vezes (`estado` para o dado, `texto` para o desenho).
 *
 * Modos (D-G27): chave `painel.projeto.opcoesComoContagem` LIGADA (as opções saem das linhas e viram "N opções") e DESLIGADA (nenhum card some). Nos dois:
 * tasks > 0 em todo plano com cabeçalho de task (37 de 38) e o plano sem cabeçalho fora da conta (REQ-PRJ-1 c).
 *
 * MUTAÇÕES (roteiro em `.tmp-gabarito/mutacoes.json`): listar os feitos no desenho · opção contada como linha · desligar o leitor de `## TN —` ·
 * ignorar a cerca ao ler o plano · a chave ligada sem efeito. Cada uma tem de derrubar este arquivo.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gerar, definirModo, FORMATOS, N_CARDS, N_OPCOES, N_ABERTOS, N_FEITOS, N_PLANOS, N_PLANOS_COM_TASK, N_CABECALHOS, N_COMMITS_PBI, COLUNAS_ABERTAS, STATUS_OPCAO } from './fixtures/gm16-repo-grande/gerador.mjs';
import { fixtureNivel2_110, hoje } from './_doctor-helpers.mjs';

const GATES = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAINEL = join(GATES, 'scripts', 'painel.mjs');
const DOCTOR = join(GATES, 'scripts', 'harness-doctor.mjs');
const TETO = 90_000;
const LARGURA = 120;

const dirs = [];
const novoDir = (p) => { const d = realpathSync(mkdtempSync(join(tmpdir(), p))); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

// HOME vazio e sem config global: o git da fixture só passa com o user explícito (gerador) e nada herda do ambiente de quem roda
const HOME = novoDir('gm16-aceite-home ');
const ENV = { PATH: process.env.PATH, HOME, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0' };

function painel(dir, args) {
  const r = spawnSync(process.execPath, [PAINEL, ...args, '--agentes'], { cwd: dir, input: JSON.stringify({ session_id: 'aceite-gm16', agentes: [] }), encoding: 'utf8', env: ENV, timeout: TETO });
  assert.equal(r.status, 0, `${args[0]}: ${r.stdout.slice(0, 300)} ${r.stderr.slice(0, 300)}`);
  return r.stdout;
}
const estadoProjeto = (dir) => {
  const j = JSON.parse(painel(dir, ['estado']));
  assert.equal(j.ok, true);
  assert.ok(j.estado.projeto, 'o estado traz a visão de projeto');
  return j.estado.projeto;
};
const textoDe = (dir) => painel(dir, ['texto', '--largura', String(LARGURA)]).replace(/\n$/, '').split('\n');
/** O bloco de projeto desenhado: da linha `PROJETO` até a última linha recuada em seguida. */
function blocoProjeto(ls) {
  const i = ls.findIndex((l) => l.startsWith('PROJETO'));
  assert.ok(i >= 0, `o painel desenha a visão de projeto:\n${ls.slice(0, 5).join('\n')}`);
  let f = i + 1;
  while (f < ls.length && /^ {2}/.test(ls[f])) f++;
  return ls.slice(i, f);
}
const linhaDoPbi = (bloco, id) => bloco.filter((l) => new RegExp(`[●○?] ${id} `).test(l));

let gen, desc, repo, gemeo;
before(() => {
  repo = novoDir('gm16-aceite-repo ');
  gemeo = novoDir('gm16-aceite-gemeo ');
  // o doctor mede nível 2 com os arquivos da fixture de nível; o gerador escreve o `harness.config.json` por último, com o fluxo mesclado
  const { 'harness.config.json': _, ...arquivosNivel } = fixtureNivel2_110(2);
  const cfgExtra = { fluxo: { resolvidoEm: hoje, idPadrao: '^[A-Z]+-\\d+$' }, versionamento: { resolvidoEm: hoje, changelog: 'CHANGELOG.md' } };
  desc = gerar(repo, HOME, { extraArquivos: arquivosNivel, cfgExtra });
  gen = { cfgExtra };
  gerar(gemeo, HOME, { limpo: true, extraArquivos: arquivosNivel, cfgExtra });
});

describe('aceite-gm16-repo-grande', () => {
  test('fixture-tem-a-forma-medida: 91 cards, 9 status, 38 planos, 265 cabeçalhos (parada cedo, antes de qualquer painel)', () => {
    const pasta = join(repo, 'docs/fluxo/pbis');
    const arquivos = readdirSync(pasta).filter((n) => n.endsWith('.md'));
    assert.equal(arquivos.length, N_CARDS);
    const status = desc.cards.map((c) => c.status);
    assert.equal(new Set(status).size, 9, '9 status distintos');
    assert.equal(new Set(status.filter((s) => !STATUS_OPCAO.includes(s))).size, 5, '5 deles são colunas');
    assert.equal(desc.cards.filter((c) => STATUS_OPCAO.includes(c.status)).length, N_OPCOES);
    assert.equal(desc.cards.filter((c) => COLUNAS_ABERTAS.includes(c.status)).length, N_ABERTOS);
    assert.equal(desc.cards.filter((c) => c.status === 'Concluído').length, N_FEITOS);
    for (const c of desc.cards) assert.match(readFileSync(join(pasta, `${c.id}.md`), 'utf8'), new RegExp(`^---\\nid: ${c.id}\\nstatus: .+\\nepic: EPIC-\\d\\n---`), `${c.id} tem a chave de Epic`);
    assert.equal(new Set(desc.cards.filter((c) => COLUNAS_ABERTAS.includes(c.status)).map((c) => c.epic)).size, 5, '5 Epics com PBI aberto');
    assert.equal(readdirSync(join(repo, 'docs/plans')).filter((n) => /^plano-\d+\.md$/.test(n)).length, N_PLANOS);
    assert.equal(desc.planos.filter((p) => p.tasks > 0).length, N_PLANOS_COM_TASK);
    assert.equal(desc.planos.reduce((s, p) => s + p.tasks, 0), N_CABECALHOS);
    for (const fm of FORMATOS) assert.equal(desc.planos.flatMap((p) => p.formatos).filter((f) => f === fm.id).length, fm.n, `formato ${fm.id}`);
    assert.equal(desc.comCommit.length, N_COMMITS_PBI);
  });

  describe('chave ligada', () => {
    let proj, ls, bloco;
    before(() => {
      definirModo(repo, HOME, true, gen.cfgExtra);
      proj = estadoProjeto(repo);
      ls = textoDe(repo);
      bloco = blocoProjeto(ls);
    });

    test('opcoes-saem-das-linhas-e-viram-N-opcoes: 44 linhas (43 abertos + 1 feito), 47 opções, nenhum card de opção listado', () => {
      assert.equal(proj.totais.opcoes, N_OPCOES);
      assert.equal(proj.linhas.length, N_ABERTOS + N_FEITOS);
      assert.equal(proj.totais.pbis, N_ABERTOS + N_FEITOS);
      const ids = new Set(proj.linhas.map((l) => l.id));
      for (const c of desc.cards.filter((x) => STATUS_OPCAO.includes(x.status))) assert.ok(!ids.has(c.id), `${c.id} (opção) não é linha`);
      assert.match(bloco[0], new RegExp(` · ${N_OPCOES} opções$`), bloco[0]);
      assert.deepEqual(proj.avisos, []);
    });

    test('teto-de-linhas: no máximo totais + 1 + abertos + grupos; feitos em 1 linha', () => {
      const grupos = proj.grupos.length;
      assert.equal(grupos, 5, '5 Epics com PBI aberto');
      assert.equal(proj.grupos.reduce((s, g) => s + g.abertos, 0), N_ABERTOS);
      // linhas de totais que o desenho produz neste cenário: contagens + previsão medida/sem ritmo (+ estimada, se houver)
      const totais = 2 + (proj.totais.previsao.estimada !== null ? 1 : 0);
      assert.equal(totais, 2, 'cenário sem ritmo e sem previsão estimada: 2 linhas de totais');
      const teto = totais + 1 + N_ABERTOS + grupos;
      assert.ok(bloco.length <= teto, `${bloco.length} linhas > teto ${teto}`);
      assert.equal(bloco.length, teto, 'neste cenário fixo o desenho tem exatamente o teto');
      assert.equal(bloco.filter((l) => /^ {2}previsão /.test(l)).length, 1, 'previsão aparece uma vez');
      assert.equal(bloco.filter((l) => /✓ \d+ feitos?$/.test(l)).length, 1);
      assert.ok(bloco.some((l) => /^ {2}✓ 1 feito$/.test(l)), 'o feito é 1 linha, com a contagem');
      const feito = desc.cards.find((c) => c.status === 'Concluído').id;
      assert.equal(linhaDoPbi(bloco, feito).length, 0, 'o PBI feito não é desenhado');
      const abertos = desc.cards.filter((c) => COLUNAS_ABERTAS.includes(c.status));
      for (const c of abertos) assert.equal(linhaDoPbi(bloco, c.id).length, 1, `${c.id} aparece uma vez`);
      for (const c of desc.cards.filter((x) => STATUS_OPCAO.includes(x.status))) assert.equal(linhaDoPbi(bloco, c.id).length, 0, `${c.id} (opção) fora do desenho`);
    });

    test('grupos-por-epic-desenhados: cabeçalho com título e contagem de abertos', () => {
      for (const g of proj.grupos) {
        const esperado = desc.cards.filter((c) => COLUNAS_ABERTAS.includes(c.status) && c.epic === g.epic).length;
        assert.equal(g.abertos, esperado, g.epic);
        const n = g.epic.replace('EPIC-', '');
        assert.equal(g.titulo, `Grupo sintético ${n}`);
        assert.ok(bloco.includes(`  ${g.epic} Grupo sintético ${n} · ${esperado} abertos`), `cabeçalho de ${g.epic}`);
      }
    });

    test('tasks-maiores-que-zero-nos-37-planos-com-cabecalho: cada plano conta os seus cabeçalhos e o sem cabeçalho fica fora da conta', () => {
      conferirTasks(proj);
    });
  });

  describe('chave desligada', () => {
    let proj, ls, bloco;
    before(() => {
      definirModo(repo, HOME, false, gen.cfgExtra);
      proj = estadoProjeto(repo);
      ls = textoDe(repo);
      bloco = blocoProjeto(ls);
    });

    test('nenhum-card-some: 91 linhas com ID, feitos em 1 linha, sem "opções"', () => {
      assert.equal(proj.linhas.length, N_CARDS);
      assert.equal(proj.totais.pbis, N_CARDS);
      assert.equal(proj.totais.opcoes, 0);
      assert.deepEqual(new Set(proj.linhas.map((l) => l.id)), new Set(desc.cards.map((c) => c.id)));
      assert.ok(!bloco.some((l) => /opç(ão|ões)/.test(l)), 'sem "opções" no desenho');
      assert.match(bloco[0], new RegExp(`^PROJETO  ${N_FEITOS} de ${N_CARDS} PBIs feitos`), bloco[0]);
      assert.deepEqual(proj.avisos, []);
    });

    test('teto-de-linhas: no máximo totais + 1 + não feitos + grupos; feitos em 1 linha', () => {
      const naoFeitos = N_CARDS - N_FEITOS;
      const grupos = proj.grupos.length;
      assert.equal(grupos, new Set(desc.cards.filter((c) => c.status !== 'Concluído').map((c) => c.epic)).size);
      assert.equal(proj.grupos.reduce((s, g) => s + g.abertos, 0), naoFeitos);
      const totais = 2 + (proj.totais.previsao.estimada !== null ? 1 : 0);
      assert.equal(totais, 2, 'cenário sem ritmo e sem previsão estimada: 2 linhas de totais');
      const teto = totais + 1 + naoFeitos + grupos;
      assert.ok(bloco.length <= teto, `${bloco.length} linhas > teto ${teto}`);
      assert.equal(bloco.length, teto, 'neste cenário fixo o desenho tem exatamente o teto');
      assert.equal(bloco.filter((l) => /^ {2}previsão /.test(l)).length, 1, 'previsão aparece uma vez');
      assert.equal(bloco.filter((l) => /✓ \d+ feitos?$/.test(l)).length, 1);
      assert.ok(bloco.some((l) => /^ {2}✓ 1 feito$/.test(l)));
      const feito = desc.cards.find((c) => c.status === 'Concluído').id;
      assert.equal(linhaDoPbi(bloco, feito).length, 0, 'o PBI feito não é desenhado');
      for (const c of desc.cards.filter((x) => x.status !== 'Concluído')) assert.equal(linhaDoPbi(bloco, c.id).length, 1, `${c.id} aparece uma vez`);
    });

    test('tasks-maiores-que-zero-nos-37-planos-com-cabecalho: a regra vale com a chave desligada', () => {
      conferirTasks(proj);
    });
  });

  // a regra das tasks, igual nos dois modos: o que o plano .md tem de cabeçalho (fora de bloco cercado, com separador) é o que o projeto conta
  function conferirTasks(proj) {
    const porId = new Map(proj.linhas.map((l) => [l.id, l]));
    let contados = 0, comTask = 0;
    for (const p of desc.planos) {
      const l = porId.get(p.card);
      assert.ok(l, `${p.card} é linha`);
      if (p.tasks === 0) {
        assert.equal(l.tasks, null, `${p.card}: plano sem cabeçalho fica fora da conta`);
        assert.equal(l.plano, 'md');
        assert.equal(l.semPlano, false);
        assert.equal(l.texto, 'plano (formato anterior)');
        continue;
      }
      comTask++;
      assert.equal(l.plano, 'md', `${p.card}: plano .md lido`);
      assert.ok(l.tasks.total > 0, `${p.card}: tasks > 0`);
      assert.equal(l.tasks.total, p.tasks, `${p.card}: ${p.arquivo} conta ${p.tasks} cabeçalhos`);
      assert.equal(l.tasks.integradas, 0);
      assert.equal(l.motivo, null);
      contados += l.tasks.total;
    }
    assert.equal(comTask, N_PLANOS_COM_TASK, '37 planos com cabeçalho de task');
    assert.equal(contados, N_CABECALHOS, '265 cabeçalhos contados, nem os 22 dentro de cerca nem o sem separador');
    assert.equal(proj.totais.tasks, N_CABECALHOS);
    assert.equal(proj.totais.restantes, N_CABECALHOS);
    assert.equal(proj.totais.integradas, 0);
    // os sem plano: abertos sem `Plano:` (5) (o plano sem cabeçalho agora é "formato anterior", fora do sem plano, GM-20 REQ-LEG-2); o feito sem plano não conta (GM-20 REQ-PCT-3)
    assert.equal(proj.totais.foraDaConta, N_ABERTOS - N_PLANOS + (proj.linhas.length === N_CARDS ? N_OPCOES : 0));
  }

  describe('doctor (CLI real): os 2 avisos e o nível não muda', () => {
    const roda = (dir) => {
      const r = spawnSync(process.execPath, [DOCTOR, '--json'], { cwd: dir, encoding: 'utf8', env: ENV, timeout: TETO });
      let json;
      try { json = JSON.parse(r.stdout); } catch { assert.fail(`saída --json ilegível (rc ${r.status}): ${r.stdout.slice(0, 200)} ${r.stderr.slice(0, 300)}`); }
      return { status: r.status, json };
    };
    const achar = (o, id) => { const r = o.json.resultados.find((x) => x.id === id); assert.ok(r, `check ${id} ausente`); return r; };

    test('avisa-os-47-fora-do-quadro-e-os-28-mergeados-abertos-sem-mudar-o-nivel', () => {
      definirModo(repo, HOME, false, gen.cfgExtra);
      const a = roda(repo);
      const b = roda(gemeo);
      const st = achar(a, 'fluxo-status-fl1');
      assert.equal(st.level, 'warn');
      assert.equal(st.found, false);
      const nomes = desc.cards.filter((c) => STATUS_OPCAO.includes(c.status)).map((c) => `${c.id}.md`).sort();
      const tres = nomes.slice(0, 3).map((n) => n.replace('.md', '')).map((id) => `${id} (${desc.cards.find((c) => c.id === id).status})`).join(', ');
      assert.ok(st.evidence.startsWith(`${N_OPCOES} cards; 3 primeiros: ${tres}`), st.evidence);
      assert.match(st.evidence, /painel\.projeto\.opcoesComoContagem: true/, 'com a chave desligada o aviso ensina a ligar');
      const mg = achar(a, 'pbi-mergeado-aberto');
      assert.equal(mg.level, 'warn');
      assert.equal(mg.found, false);
      assert.match(mg.evidence, new RegExp(`^${N_COMMITS_PBI} PBI\\(s\\) em aberto já têm commit de PBI no 1º pai da base \`main\``), mg.evidence);
      // o gêmeo (mesmos arquivos, status do quadro e nenhum commit de PBI) é o contrafactual: os avisos calam, o nível e o exit code são os mesmos
      assert.equal(achar(b, 'fluxo-status-fl1').found, true);
      assert.equal(achar(b, 'pbi-mergeado-aberto').found, true);
      assert.equal(b.json.alcancado, 2, 'premissa: o gêmeo chega ao nível 2');
      assert.equal(a.json.alcancado, b.json.alcancado, 'os avisos não mexem no nível');
      assert.equal(a.status, b.status, 'nem no exit code');
      assert.equal(a.status, 0);
    });
  });
});

/**
 * GM-14 T6 (REQ-DIA-2): `loop.mjs anotar`, pela borda (processo real, repositório git temporário por caso).
 *
 * Cada caso lê o campo gravado (P15) e, nas recusas, prova "nada gravado" comparando a árvore inteira fora de `.git` byte a byte.
 * Ataques da Sombra para a T6 (sombra-dp.md): (1) `--entrega` válida e diferente da branch grava nela e não identifica;
 * (2) `--opcao` repetida com outra caixa; (3) 160 caracteres multibyte contados por caractere.
 *
 * MUTAÇÕES PRESCRITAS: task-6-mut.json da entrega.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as diario from '../dist/diario.js';
import { ID_PERGUNTA_RE } from '../dist/formas.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(AQUI, '..', 'scripts', 'loop.mjs');
const SK = `sk-${'a1B2c3D4'.repeat(4)}`; // casa o canário `sk` (16+ alfanuméricos)
const TMPS = [];
after(() => { for (const d of TMPS) rmSync(d, { recursive: true, force: true }); });

const g = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Repositório git com uma branch e identidade explícita (sem `.harness/` ainda). */
function ambiente({ branch = 'enabler/GM-10-loop' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'loop-anotar-'));
  TMPS.push(dir);
  g(dir, 'init', '-q', '-b', branch);
  g(dir, 'config', 'user.email', 't@t');
  g(dir, 'config', 'user.name', 't');
  g(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'a.txt'), 'x\n');
  g(dir, 'add', '-A');
  g(dir, 'commit', '-q', '-m', 'base');
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR)/.test(k)) delete env[k];
  const entregas = join(dir, '.harness', 'entregas');
  const amb = {
    dir, entregas, env,
    pasta: (id) => join(entregas, id),
    cli: (args, { cwd = dir } = {}) => {
      const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env });
      let j = null;
      try { j = JSON.parse(r.stdout.trim()); } catch { /* fica null */ }
      return { rc: r.status, j, out: r.stdout, err: r.stderr };
    },
    eventos: (id) => diario.ler(join(entregas, id)),
    /** Árvore inteira fora de `.git`: caminho e sha256 de cada arquivo (e cada pasta). Recusa ⇒ igual antes e depois. */
    foto: () => {
      const lista = [];
      const andar = (d) => {
        for (const n of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, n.name);
          if (n.name === '.git') continue;
          if (n.isDirectory()) { lista.push(`${p}/`); andar(p); } else lista.push(`${p} ${createHash('sha256').update(readFileSync(p)).digest('hex')}`);
        }
      };
      andar(dir);
      return lista.sort();
    },
  };
  return amb;
}

/** `anotar` que recusa: rc 1, 1 linha de JSON `ok:false` com o `erro` pedido, nada gravado. */
function recusa(amb, args, erro, rc = 1) {
  const antes = amb.foto();
  const r = amb.cli(args);
  assert.equal(r.rc, rc, `${args.join(' ')}: ${r.out}${r.err}`);
  assert.ok(r.j !== null, `saída não é 1 linha JSON: ${r.out}`);
  assert.equal(r.j.ok, false);
  assert.equal(r.j.erro, erro, r.out);
  assert.deepEqual(amb.foto(), antes, `${args.join(' ')}: gravou algo`);
  return r;
}

describe('GM-14 T6: loop.mjs anotar', () => {
  test('anotar-sem-plano-grava: branch com ID e nenhum plano.json ⇒ nota no diário da entrega, todos os campos', () => {
    const amb = ambiente();
    assert.equal(existsSync(join(amb.pasta('GM-10'), 'plano.json')), false);
    const r = amb.cli(['anotar', '--tipo', 'ideia', '--texto', 'trocar o nome do botão']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.ok, true);
    assert.equal(r.j.entrega, 'GM-10');
    assert.deepEqual(r.j.evento, { tipo: 'nota', dados: { tipo: 'ideia', texto: 'trocar o nome do botão' } });
    const ev = amb.eventos('GM-10');
    assert.equal(ev.length, 1);
    assert.equal(ev[0].tipo, 'nota');
    assert.deepEqual(ev[0].dados, { tipo: 'ideia', texto: 'trocar o nome do botão' }); // sem `opcoes` fora da dúvida
    assert.equal(ev[0].seq, 1);
    assert.equal(ev[0].sessao, 'loop');
    assert.equal(ev[0].agente, 'orquestrador');
    assert.equal(ev[0].autor, 't@t');
    assert.equal(ev[0].hash_anterior, null);
    assert.equal(r.j.sessao, 'loop');
  });

  test('anotar-cada-tipo: ideia, desvio, assunto, pendencia gravam o tipo pedido (troca de tipo não passa)', () => {
    const amb = ambiente();
    for (const tipo of ['ideia', 'desvio', 'assunto', 'pendencia']) {
      const r = amb.cli(['anotar', '--tipo', tipo, '--texto', `texto de ${tipo}`]);
      assert.equal(r.rc, 0, r.out + r.err);
    }
    assert.deepEqual(amb.eventos('GM-10').map((e) => [e.dados.tipo, e.dados.texto]), [
      ['ideia', 'texto de ideia'], ['desvio', 'texto de desvio'], ['assunto', 'texto de assunto'], ['pendencia', 'texto de pendencia'],
    ]);
    // a cadeia fecha: seq 1..4 e hash_anterior conferem pelo leitor estrito do núcleo
    const lido = diario.lerEstrito(amb.pasta('GM-10'));
    assert.equal(lido.ok, true, JSON.stringify(lido));
    assert.deepEqual(lido.eventos.map((e) => e.seq), [1, 2, 3, 4]);
  });

  test('anotar-sem-id-vai-a-sem-id: branch sem ID e HEAD destacado ⇒ _sem-id, nada em pasta de entrega', () => {
    for (const preparar of [(amb) => amb, (amb) => { g(amb.dir, 'checkout', '-q', '--detach'); return amb; }]) {
      const amb = preparar(ambiente({ branch: 'main' }));
      const r = amb.cli(['anotar', '--tipo', 'assunto', '--texto', 'conversa nova']);
      assert.equal(r.rc, 0, r.out + r.err);
      assert.equal(r.j.entrega, '_sem-id');
      assert.deepEqual(readdirSync(amb.entregas), ['_sem-id']);
      assert.deepEqual(amb.eventos('_sem-id').map((e) => [e.tipo, e.dados.tipo, e.dados.texto]), [['nota', 'assunto', 'conversa nova']]);
    }
  });

  test('anotar-entrega-diferente-da-branch: --entrega válida grava NELA, o diário da branch fica sem evento e a nota não cria fato de identificação (M19 irmão)', () => {
    const amb = ambiente(); // branch GM-10
    const r = amb.cli(['anotar', '--tipo', 'ideia', '--texto', 'ideia para a próxima', '--entrega', 'GM-99']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.entrega, 'GM-99');
    assert.deepEqual(readdirSync(amb.entregas), ['GM-99']); // GM-10 nem nasceu
    const ev = amb.eventos('GM-99');
    assert.deepEqual(ev.map((e) => e.tipo), ['nota']); // só a nota: nada de entrega.*, sessao.* nem fato.medido que "identifique" GM-99
    assert.equal(ev[0].dados.texto, 'ideia para a próxima');
  });

  test('anotar-entrega-explicita-vence-a-branch-e-o-sem-id: --entrega GM-5 numa branch main vai a GM-5, não a _sem-id', () => {
    const amb = ambiente({ branch: 'main' });
    const r = amb.cli(['anotar', '--tipo', 'pendencia', '--texto', 'avisar o time', '--entrega', 'GM-5']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.deepEqual(readdirSync(amb.entregas), ['GM-5']);
  });

  test('anotar-duvida-grava-opcoes: 2 e 4 opções na ordem dada, rótulos intactos', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['anotar', '--tipo', 'duvida', '--texto', 'qual caminho?', '--opcao', 'sim', '--opcao', 'não']).rc, 0);
    assert.equal(amb.cli(['anotar', '--tipo', 'duvida', '--texto', 'e agora?', '--opcao', 'a', '--opcao', 'b', '--opcao', 'c', '--opcao', 'd']).rc, 0);
    const ev = amb.eventos('GM-10');
    assert.deepEqual(ev[0].dados, { tipo: 'duvida', texto: 'qual caminho?', opcoes: ['sim', 'não'] });
    assert.deepEqual(ev[1].dados.opcoes, ['a', 'b', 'c', 'd']);
  });

  test('duvida-sem-opcao-ou-com-1-recusa: M-T6a aceitaria dúvida sem opções', () => {
    const amb = ambiente();
    recusa(amb, ['anotar', '--tipo', 'duvida', '--texto', 'e agora?'], 'forma_invalida');
    recusa(amb, ['anotar', '--tipo', 'duvida', '--texto', 'e agora?', '--opcao', 'sim'], 'forma_invalida');
  });

  test('duvida-5-opcoes-recusa', () => {
    const amb = ambiente();
    const r = recusa(amb, ['anotar', '--tipo', 'duvida', '--texto', 'e agora?', ...['a', 'b', 'c', 'd', 'e'].flatMap((o) => ['--opcao', o])], 'forma_invalida');
    assert.match(r.j.mensagem, /2 a 4/);
  });

  test('opcao-fora-da-duvida-recusa: só `duvida` leva opção', () => {
    const amb = ambiente();
    for (const tipo of ['ideia', 'desvio', 'assunto', 'pendencia']) {
      recusa(amb, ['anotar', '--tipo', tipo, '--texto', 'algo', '--opcao', 'sim', '--opcao', 'não'], 'forma_invalida');
    }
  });

  test('opcao-repetida-recusa-sem-caixa-e-sem-espaco-nas-pontas (ataque 2): "Sim"/"sim" e "sim"/" sim " são a mesma opção', () => {
    const amb = ambiente();
    recusa(amb, ['anotar', '--tipo', 'duvida', '--texto', 'e agora?', '--opcao', 'Sim', '--opcao', 'sim'], 'forma_invalida');
    recusa(amb, ['anotar', '--tipo', 'duvida', '--texto', 'e agora?', '--opcao', 'sim', '--opcao', ' sim '], 'forma_invalida');
    recusa(amb, ['anotar', '--tipo', 'duvida', '--texto', 'e agora?', '--opcao', 'NÃO', '--opcao', 'não'], 'forma_invalida');
    // o vizinho que NÃO é repetição passa: rótulos diferentes ("sim" × "sim, mas depois")
    assert.equal(amb.cli(['anotar', '--tipo', 'duvida', '--texto', 'e agora?', '--opcao', 'sim', '--opcao', 'sim, mas depois']).rc, 0);
  });

  test('opcao-60-passa-61-recusa: o teto é por caractere', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['anotar', '--tipo', 'duvida', '--texto', 'e agora?', '--opcao', 'é'.repeat(60), '--opcao', 'b']).rc, 0);
    recusa(amb, ['anotar', '--tipo', 'duvida', '--texto', 'e agora?', '--opcao', 'é'.repeat(61), '--opcao', 'b'], 'forma_invalida');
    recusa(amb, ['anotar', '--tipo', 'duvida', '--texto', 'e agora?', '--opcao', '   ', '--opcao', 'b'], 'forma_invalida');
  });

  test('anotar-token-recusa: canário no texto e numa opção ⇒ rc 1, nada gravado (diário e árvore byte a byte), valor fora da saída', () => {
    const amb = ambiente();
    assert.equal(amb.cli(['anotar', '--tipo', 'ideia', '--texto', 'primeira, limpa']).rc, 0); // diário existente: o byte a byte tem o que proteger
    const nTexto = recusa(amb, ['anotar', '--tipo', 'ideia', '--texto', `a chave é ${SK}`], 'segredo_na_nota');
    const nOpcao = recusa(amb, ['anotar', '--tipo', 'duvida', '--texto', 'qual usar?', '--opcao', 'sim', '--opcao', `usar ${SK}`], 'segredo_na_nota');
    for (const r of [nTexto, nOpcao]) assert.equal((r.out + r.err).includes(SK), false, 'o valor do segredo vazou na saída');
    assert.match(nTexto.j.mensagem, /texto/);
    assert.match(nOpcao.j.mensagem, /opcao 2/);
    assert.equal(amb.eventos('GM-10').length, 1); // nem `diario.recusa` foi gravada
    // o canário também vale para BEGIN e URL com credencial (outros padrões do diário)
    recusa(amb, ['anotar', '--tipo', 'ideia', '--texto', 'chave -----BEGIN PRIVATE KEY'], 'segredo_na_nota');
    recusa(amb, ['anotar', '--tipo', 'ideia', '--texto', 'ver https://u:senha@host/x'], 'segredo_na_nota');
  });

  test('anotar-160-passa-161-recusa: o limite é por caractere (ataque 3: emoji e acento, 160 passam, 161 não)', () => {
    const amb = ambiente();
    for (const unidade of ['a', 'é', '😀', 'ç']) {
      const ok = unidade.repeat(160);
      const r = amb.cli(['anotar', '--tipo', 'ideia', '--texto', ok]);
      assert.equal(r.rc, 0, `${unidade} x160: ${r.out}${r.err}`);
      assert.equal(amb.eventos('GM-10').at(-1).dados.texto, ok);
    }
    const antes = amb.eventos('GM-10').length;
    for (const unidade of ['a', 'é', '😀']) {
      const r = recusa(amb, ['anotar', '--tipo', 'ideia', '--texto', unidade.repeat(161)], 'forma_invalida');
      assert.match(r.j.mensagem, /161 caracteres/);
    }
    assert.equal(amb.eventos('GM-10').length, antes);
    // 160 emoji = 320 unidades UTF-16 e 640 bytes: conta por byte ou por `.length` recusaria o que passou acima
    assert.equal('😀'.repeat(160).length, 320);
    assert.equal(Buffer.byteLength('😀'.repeat(160)), 640);
  });

  test('anotar-texto-invalido: vazio, só espaço e quebra de linha recusam', () => {
    const amb = ambiente();
    recusa(amb, ['anotar', '--tipo', 'ideia', '--texto', ''], 'forma_invalida');
    recusa(amb, ['anotar', '--tipo', 'ideia', '--texto', '   '], 'forma_invalida');
    recusa(amb, ['anotar', '--tipo', 'ideia', '--texto', 'linha 1\nlinha 2'], 'forma_invalida');
  });

  test('anotar-tipo-fora-da-lista: caixa e tipo desconhecido recusam, e o motivo não ecoa o valor', () => {
    const amb = ambiente();
    recusa(amb, ['anotar', '--tipo', 'Ideia', '--texto', 'algo'], 'forma_invalida');
    const r = recusa(amb, ['anotar', '--tipo', 'nota', '--texto', 'algo'], 'forma_invalida');
    assert.match(r.j.mensagem, /ideia \| desvio \| assunto \| duvida \| pendencia/);
    // um segredo digitado no lugar do tipo não é repetido na recusa
    const s = recusa(amb, ['anotar', '--tipo', SK, '--texto', 'algo'], 'forma_invalida');
    assert.equal((s.out + s.err).includes(SK), false);
  });

  test('anotar-uso: sem --tipo ou --texto, flag desconhecida, posicional, flag repetida e flag sem valor saem 2', () => {
    const amb = ambiente();
    recusa(amb, ['anotar'], 'uso', 2);
    recusa(amb, ['anotar', '--texto', 'algo'], 'uso', 2);
    recusa(amb, ['anotar', '--tipo', 'ideia'], 'uso', 2);
    recusa(amb, ['anotar', '--tipo', 'ideia', '--texto', 'a', '--cor', 'azul'], 'uso', 2);
    recusa(amb, ['anotar', '--tipo', 'ideia', '--texto', 'a', 'solto'], 'uso', 2);
    recusa(amb, ['anotar', '--tipo', 'ideia', '--tipo', 'desvio', '--texto', 'a'], 'uso', 2);
    recusa(amb, ['anotar', '--tipo', 'ideia', '--texto', 'a', '--entrega', 'GM-1', '--entrega', 'GM-2'], 'uso', 2);
    recusa(amb, ['anotar', '--tipo', 'ideia', '--texto'], 'uso', 2);
    // limite declarado: valor que começa com `--` é lido como flag (igual aos demais subcomandos); sai 2 e nunca ecoa o valor
    const r = recusa(amb, ['anotar', '--tipo', 'ideia', '--texto', `--${SK}`], 'uso', 2);
    assert.equal((r.out + r.err).includes(SK), false);
  });

  test('anotar-entrega-invalida: ../GM-1, minúscula e lixo recusam sem criar pasta', () => {
    const amb = ambiente();
    for (const e of ['../GM-1', 'gm-1', 'GM-', 'GM-1/x', 'GM-1 ']) {
      recusa(amb, ['anotar', '--tipo', 'ideia', '--texto', 'a', '--entrega', e], 'entrega_invalida');
    }
    assert.equal(existsSync(amb.entregas), false);
    assert.equal(existsSync(join(amb.dir, '..', 'GM-1')), false);
  });

  test('anotar-sessao-alinhada-ao-id-da-pergunta: a_b, a.b e herdar recusam; sess-1 grava em events.sess-1.jsonl e o id <sessao>:<seq> responde à forma', () => {
    const amb = ambiente();
    for (const s of ['a_b', 'a.b', 'herdar', 'a:b', 'x'.repeat(129)]) {
      recusa(amb, ['anotar', '--tipo', 'duvida', '--texto', 'e agora?', '--opcao', 'sim', '--opcao', 'não', '--sessao', s], 'argumento_invalido');
    }
    const r = amb.cli(['anotar', '--tipo', 'duvida', '--texto', 'e agora?', '--opcao', 'sim', '--opcao', 'não', '--sessao', 'sess-1']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.sessao, 'sess-1');
    assert.deepEqual(readdirSync(amb.pasta('GM-10')), ['events.sess-1.jsonl']);
    const ev = amb.eventos('GM-10')[0];
    assert.equal(ev.sessao, 'sess-1');
    assert.match(`${ev.sessao}:${ev.seq}`, ID_PERGUNTA_RE); // a pergunta que o painel abrir para esta nota é respondível
    assert.equal(ID_PERGUNTA_RE.test('herdar:1'), false); // e `herdar` não seria
  });

  test('anotar-diario-ausente-x-corrompido: ausente cria e grava seq 1; linha ilegível e cadeia quebrada recusam (diario_ilegivel) sem alterar um byte', () => {
    // ausente: nem a pasta .harness existe
    const aus = ambiente();
    assert.equal(existsSync(aus.entregas), false);
    const r0 = aus.cli(['anotar', '--tipo', 'ideia', '--texto', 'primeira']);
    assert.equal(r0.rc, 0, r0.out + r0.err);
    assert.equal(aus.eventos('GM-10')[0].seq, 1);

    // corrompido 1: linha que não é JSON no fim do arquivo
    const c1 = ambiente();
    assert.equal(c1.cli(['anotar', '--tipo', 'ideia', '--texto', 'boa']).rc, 0);
    appendFileSync(join(c1.pasta('GM-10'), 'events.loop.jsonl'), 'isto nao e json\n');
    const e1 = recusa(c1, ['anotar', '--tipo', 'ideia', '--texto', 'depois do lixo'], 'diario_ilegivel');
    assert.match(e1.j.mensagem, /não é JSON/);

    // corrompido 2: linha íntegra em JSON, mas com a cadeia de hash quebrada, noutra sessão (o diário da entrega é um só)
    const c2 = ambiente();
    mkdirSync(c2.pasta('GM-10'), { recursive: true });
    const ev = { seq: 1, ts: '2026-01-01T00:00:00.000Z', autor: 'x', sessao: 'outra', agente: 'orquestrador', tipo: 'nota', dados: { tipo: 'ideia', texto: 'z' }, hash_anterior: 'f'.repeat(64) };
    writeFileSync(join(c2.pasta('GM-10'), 'events.outra.jsonl'), `${JSON.stringify(ev)}\n`);
    const e2 = recusa(c2, ['anotar', '--tipo', 'ideia', '--texto', 'sobre a cadeia quebrada'], 'diario_ilegivel');
    assert.match(e2.j.mensagem, /cadeia de hash quebrada/);

    // os três são coisas diferentes: ausente deu ok; corrompido deu erro com causa
    assert.notEqual(r0.j.ok, e1.j.ok);
  });

  test('anotar-ordem-forma-canario-repo-diario: a forma vem antes do canário, e os dois antes de tocar repositório e diário', () => {
    const solto = mkdtempSync(join(tmpdir(), 'loop-anotar-ordem-'));
    TMPS.push(solto);
    const amb = ambiente();
    // forma ruim fora de repositório: forma_invalida (e não fora_de_repo); canário fora de repositório: segredo_na_nota
    const forma = amb.cli(['anotar', '--tipo', 'duvida', '--texto', 'e agora?'], { cwd: solto });
    assert.equal(forma.j.erro, 'forma_invalida', forma.out);
    const canario = amb.cli(['anotar', '--tipo', 'ideia', '--texto', `chave ${SK}`], { cwd: solto });
    assert.equal(canario.j.erro, 'segredo_na_nota', canario.out);
    assert.deepEqual(readdirSync(solto), []);
    // texto com segredo E 161 caracteres: a forma (1ª) responde, e a mensagem não cita o padrão do canário
    const duas = recusa(amb, ['anotar', '--tipo', 'ideia', '--texto', `${SK} ${'a'.repeat(161)}`], 'forma_invalida');
    assert.equal((duas.out + duas.err).includes(SK), false);
    // forma ruim sobre diário corrompido: forma_invalida (o diário nem é aberto)
    assert.equal(amb.cli(['anotar', '--tipo', 'ideia', '--texto', 'boa']).rc, 0);
    appendFileSync(join(amb.pasta('GM-10'), 'events.loop.jsonl'), 'lixo\n');
    recusa(amb, ['anotar', '--tipo', 'duvida', '--texto', 'e agora?'], 'forma_invalida');
    recusa(amb, ['anotar', '--tipo', 'ideia', '--texto', `chave ${SK}`], 'segredo_na_nota');
  });

  test('anotar-nao-le-plano: plano.json corrompido e entrega sem plano não atrapalham', () => {
    const amb = ambiente();
    mkdirSync(amb.pasta('GM-10'), { recursive: true });
    writeFileSync(join(amb.pasta('GM-10'), 'plano.json'), '{isto nao e json');
    const r = amb.cli(['anotar', '--tipo', 'pendencia', '--texto', 'comprar o domínio']);
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(readFileSync(join(amb.pasta('GM-10'), 'plano.json'), 'utf8'), '{isto nao e json'); // intocado
  });

  test('anotar-fora-de-repo: sem repositório git não há diário ⇒ fora_de_repo, nada criado', () => {
    const solto = mkdtempSync(join(tmpdir(), 'loop-anotar-solto-'));
    TMPS.push(solto);
    const amb = ambiente();
    const r = amb.cli(['anotar', '--tipo', 'ideia', '--texto', 'a'], { cwd: solto });
    assert.equal(r.rc, 1, r.out + r.err);
    assert.equal(r.j.erro, 'fora_de_repo');
    assert.deepEqual(readdirSync(solto), []);
  });

  test('anotar-da-worktree-grava-na-raiz-principal: cwd numa worktree wt/GM-10-T1 ⇒ diário da raiz, entrega pela branch da worktree', () => {
    const amb = ambiente({ branch: 'main' });
    const wt = join(amb.dir, '.harness', 'worktrees', 'T1');
    g(amb.dir, 'worktree', 'add', '-q', '-b', 'wt/GM-10-T1', wt);
    const r = amb.cli(['anotar', '--tipo', 'desvio', '--texto', 'tive de tocar outro arquivo'], { cwd: wt });
    assert.equal(r.rc, 0, r.out + r.err);
    assert.equal(r.j.entrega, 'GM-10');
    assert.equal(amb.eventos('GM-10')[0].dados.tipo, 'desvio');
    assert.equal(existsSync(join(wt, '.harness', 'entregas')), false);
  });

  test('anotar-atravessa-o-nucleo (P9): o diário com notas passa no leitor estrito e na projeção que o pouso e o painel usam', () => {
    const amb = ambiente();
    amb.cli(['anotar', '--tipo', 'ideia', '--texto', 'uma ideia']);
    amb.cli(['anotar', '--tipo', 'duvida', '--texto', 'qual?', '--opcao', 'um', '--opcao', 'dois']);
    const lido = diario.lerEstrito(amb.pasta('GM-10'));
    assert.equal(lido.ok, true, JSON.stringify(lido));
    const p = diario.projetar(lido.eventos);
    assert.equal(typeof p.instantaneo, 'string');
    // o mesmo diário aceita o `proxima` real do loop, que lê o diário estritamente (sem plano ⇒ plano_ausente, nunca diario_ilegivel)
    const prox = amb.cli(['proxima', '--vivos', '0']);
    assert.notEqual(prox.j?.erro, 'diario_ilegivel', prox.out);
  });
});

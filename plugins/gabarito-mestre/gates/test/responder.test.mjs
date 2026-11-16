/**
 * REQ-PRG-1 (GM-14 T14): o dono responde a pergunta do painel por `/gabarito-mestre:responder <sessao>:<seq> <n>`.
 * Hook `UserPromptExpansion` (`responder.mjs`, adaptador fino, desenho de `aprovar-spec.mjs`): cada caso sobe um repositório git descartável,
 * semeia o diário pelo núcleo (`diario.append`, nunca à mão) e roda o hook real com o stdin do TUI.
 *
 * Contrato herdado da T12: `perguntasAbertas`/`respostaValida` (perguntas.ts) e `pendenciaAberta` (depende.ts) são as funções únicas; o
 * hook as importa, e o teste `botao-do-depende-responde` (P9) parte de `dependeDe` real, passa pelo comando do botão, pelo hook e chega a
 * `perguntasAbertas` sem a pergunta.
 *
 * Limite declarado (como `aprovarSpec`): sem lock entre sessões, 2 respostas simultâneas gravam 2; o hook detecta pela releitura.
 *
 * MUTAÇÕES PRESCRITAS: task-14-mut.json da entrega.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as diario from '../dist/diario.js';
import { dependeDe } from '../dist/depende.js';
import { perguntasAbertas } from '../dist/perguntas.js';
import { trilhaDe } from '../dist/trilha.js';
import { decidir } from '../scripts/responder.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const HOOK = join(AQUI, '..', 'scripts', 'responder.mjs');
const COMANDO = 'gabarito-mestre:responder';
const IDPADRAO = '^[A-Z]+-\\d+$';

const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

let relogio = Date.UTC(2026, 10, 1);
const ts = () => new Date((relogio += 60_000)).toISOString();

/** Repo descartável na `branch`, com a pasta de diários. */
function repo({ branch = 'main' } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'responder-')));
  git(dir, 'init', '-q', '-b', branch);
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'chore: base');
  const entregas = join(dir, '.harness', 'entregas');
  mkdirSync(entregas, { recursive: true });
  const amb = {
    dir,
    entregas,
    pasta: (id) => join(entregas, id),
    /** `semear(entrega, [[tipo, dados], …], sessao)`: grava pelo núcleo; `entrega` `null` ⇒ `_sem-id`. */
    /** GM-15 T35 (r.13): `agente` ausente ⇒ orquestrador; pendência/ideia do DEPENDE precisam de autoria fora do orquestrador. */
    semear(entrega, lista, sessao = 'loop', agente = 'orquestrador') {
      const alvo = amb.pasta(entrega ?? '_sem-id');
      for (const [tipo, dados] of lista) {
        const r = diario.append(alvo, sessao, { ts: ts(), autor: 't@t', sessao, agente, tipo, dados });
        assert.ok(r.ok && r.gravado === 'evento', JSON.stringify(r));
      }
    },
    eventos: (entrega) => diario.ler(amb.pasta(entrega ?? '_sem-id')),
    /** bytes de todos os diários (qualquer pasta), para provar "nada gravado". */
    bytes() {
      const out = {};
      const ande = (d, rel) => {
        for (const n of readdirSync(d).sort()) {
          const p = join(d, n);
          if (statSync(p).isDirectory()) ande(p, `${rel}${n}/`); else out[`${rel}${n}`] = readFileSync(p, 'utf8');
        }
      };
      ande(entregas, '');
      return out;
    },
    spec(nome, texto) {
      mkdirSync(join(dir, 'docs', 'superpowers', 'specs'), { recursive: true });
      writeFileSync(join(dir, 'docs', 'superpowers', 'specs', nome), texto);
    },
  };
  return amb;
}

const duvida = (texto, opcoes) => ['nota', { tipo: 'duvida', texto, opcoes }];

/** stdin do TUI (spike A1): `agent_id` só quando vem de subagent. */
const stdinTui = (dir, args, extra = {}) => ({
  session_id: 'S-dono', cwd: dir, hook_event_name: 'UserPromptExpansion', command_name: COMANDO, command_args: args, command_source: 'plugin', ...extra,
});

function hook(entrada, { cwd } = {}) {
  const input = typeof entrada === 'string' ? entrada : JSON.stringify(entrada);
  const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8', cwd });
  let j = null;
  try { j = r.stdout.trim() === '' ? null : JSON.parse(r.stdout); } catch { /* fica null */ }
  return { rc: r.status, j, out: r.stdout, err: r.stderr };
}
function bloqueou(r, causa) {
  assert.equal(r.rc, 0, `hook sai 0: ${r.err}`);
  assert.equal(r.j?.decision, 'block', `block esperado: ${r.out}`);
  assert.match(String(r.j.reason), causa);
}
/** Recusa pelo hook com 0 bytes novos em qualquer diário. */
function recusa(amb, entrada, causa) {
  const antes = amb.bytes();
  bloqueou(hook(entrada), causa);
  assert.deepEqual(amb.bytes(), antes, 'recusa não grava nada');
}
const respostas = (amb, entrega) => amb.eventos(entrega).filter((e) => e.tipo === 'dono.resposta');

/** Repo com 1 dúvida de 3 opções em `_sem-id` (id `loop:1`). */
function comDuvida(opts) {
  const amb = repo(opts);
  amb.semear(null, [duvida('Qual caminho seguir?', ['caminho alfa', 'caminho beta', 'caminho gama'])]);
  return amb;
}

test('responder-ok-grava-rotulo-da-opcao: o botão grava {pergunta, opcao, rotulo da opção}, relido; o rótulo nunca vem do argumento (M-T14b)', () => {
  const amb = comDuvida();
  const r = hook(stdinTui(amb.dir, 'loop:1 2'));
  assert.equal(r.rc, 0, r.err);
  assert.notEqual(r.j?.decision, 'block', r.out);
  assert.equal(r.j.systemMessage, 'Resposta registrada: caminho beta.');
  const rs = respostas(amb);
  assert.equal(rs.length, 1);
  assert.deepEqual(rs[0].dados, { pergunta: 'loop:1', opcao: 2, rotulo: 'caminho beta' });
  assert.equal(rs[0].sessao, 'S-dono');
  assert.equal(rs[0].tipo, 'dono.resposta');
  assert.equal(rs[0].agente, 'orquestrador');
  assert.equal(rs[0].seq, 1);
  // a pergunta saiu das abertas (a mesma função que o painel usa)
  const eventos = diario.ler(amb.pasta('_sem-id'));
  const t = trilhaDe({ branch: 'main', idPadrao: IDPADRAO, specs: [], plano: null, ledger: false, gh: 'nunca', ultimas: [], sessao: 'S-dono' }, eventos);
  assert.deepEqual(perguntasAbertas(eventos, t, { sessao: 'S-dono' }), []);
  // cada opção grava o seu rótulo
  for (const [n, rotulo] of [[1, 'caminho alfa'], [3, 'caminho gama']]) {
    const outro = comDuvida();
    assert.notEqual(hook(stdinTui(outro.dir, `loop:1 ${n}`)).j?.decision, 'block');
    assert.deepEqual(respostas(outro)[0].dados, { pergunta: 'loop:1', opcao: n, rotulo });
  }
});

test('subagent-block: agent_id presente (qualquer valor) recusa com 0 bytes novos e a pergunta segue aberta (M-T14a)', () => {
  const amb = comDuvida();
  for (const id of ['sub-1', '', null, 0, false]) {
    recusa(amb, stdinTui(amb.dir, 'loop:1 1', { agent_id: id }), /subagent/);
  }
  assert.equal(respostas(amb).length, 0);
  assert.notEqual(hook(stdinTui(amb.dir, 'loop:1 1')).j?.decision, 'block', 'sem agent_id o mesmo pedido grava');
});

test('responder-duplo-segunda-recusa: a 2ª resposta à mesma pergunta recusa como respondida e o rótulo da 1ª fica', () => {
  const amb = comDuvida();
  assert.notEqual(hook(stdinTui(amb.dir, 'loop:1 1')).j?.decision, 'block');
  recusa(amb, stdinTui(amb.dir, 'loop:1 3'), /respondida/);
  recusa(amb, stdinTui(amb.dir, 'loop:1 1'), /respondida/);
  assert.deepEqual(respostas(amb).map((e) => e.dados.rotulo), ['caminho alfa']);
});

test('responder-pergunta-de-outro-diario: id que só existe no diário de OUTRA entrega ⇒ inexistente, 0 bytes em todos os diários', () => {
  const amb = repo({ branch: 'enabler/GM-10-x' });
  amb.semear('GM-99', [duvida('Pergunta da outra entrega?', ['sim senhor', 'não senhor'])]);
  amb.semear('GM-10', [['nota', { tipo: 'desvio', texto: 'só para criar o diário' }]]);
  recusa(amb, stdinTui(amb.dir, 'loop:1 1'), /inexistente/);
  // id que não existe em lugar nenhum
  recusa(amb, stdinTui(amb.dir, 'loop:77 1'), /inexistente/);
  // `_onboarding` nunca é lugar de resposta
  amb.semear('_onboarding', [duvida('Pergunta do onboarding?', ['um', 'dois'])]);
  recusa(amb, stdinTui(amb.dir, 'loop:1 1'), /inexistente/);
});

test('mesmo-id-em-dois-diarios-block: o mesmo <sessao>:<seq> aberto na entrega da branch E em _sem-id ⇒ block, nada gravado (ataque 1)', () => {
  const amb = repo({ branch: 'enabler/GM-10-x' });
  amb.semear('GM-10', [duvida('Dúvida na entrega?', ['sim aqui', 'não aqui'])]);
  amb.semear(null, [duvida('Dúvida solta?', ['sim ali', 'não ali'])]);
  recusa(amb, stdinTui(amb.dir, 'loop:1 1'), /ambigua.*GM-10 e _sem-id|nos diários de GM-10 e _sem-id/);
  assert.equal(respostas(amb, 'GM-10').length + respostas(amb).length, 0);
  // com o id só em um deles, grava naquele (e só naquele)
  const so = repo({ branch: 'enabler/GM-10-x' });
  so.semear('GM-10', [duvida('Dúvida na entrega?', ['sim aqui', 'não aqui'])]);
  assert.notEqual(hook(stdinTui(so.dir, 'loop:1 2')).j?.decision, 'block');
  assert.deepEqual(respostas(so, 'GM-10').map((e) => e.dados.rotulo), ['não aqui']);
  assert.equal(so.eventos(null).length, 0);
});

test('herdar-nunca-aceito: <id> herdar:<hex> recusa, mesmo com a pergunta no diário _onboarding; 0 bytes novos (ataque 1)', () => {
  const amb = comDuvida();
  amb.semear('_onboarding', [['nota', { tipo: 'desvio', texto: 'regra herdada' }]]);
  for (const a of ['herdar:0123456789abcdef 1', 'herdar:0123456789abcdef 1 extra', 'HERDAR:0123456789abcdef 1', 'herdar:xyz 1']) {
    recusa(amb, stdinTui(amb.dir, a), /herança|fora da forma/);
  }
});

test('opcao-fora-block: opção acima da lista e opção que não é inteiro positivo não gravam resposta com rótulo; a pergunta segue aberta', () => {
  const amb = comDuvida();
  recusa(amb, stdinTui(amb.dir, 'loop:1 4'), /opcao_fora/);
  recusa(amb, stdinTui(amb.dir, 'loop:1 999999999'), /opcao_fora/);
  // 0, negativo, decimal e zero à esquerda não são opção: viram resposta digitada (só hash), nunca opção
  for (const a of ['loop:1 0', 'loop:1 -1', 'loop:1 1.5', 'loop:1 02', 'loop:1 1e0']) {
    bloqueou(hook(stdinTui(amb.dir, a)), /não reconhecida/);
  }
  assert.equal(respostas(amb).filter((e) => 'rotulo' in e.dados).length, 0);
  assert.notEqual(hook(stdinTui(amb.dir, 'loop:1 3')).j?.decision, 'block', 'a pergunta seguiu aberta (hash não fecha)');
});

test('argumento-extra-so-hash: argumento a mais grava {pergunta, sha256, chars} dos args, bloqueia, e o texto nunca entra em .harness/ (ataque 2)', () => {
  const amb = comDuvida();
  const args = 'loop:1 2 SENTINELA-do-dono-xyz';
  bloqueou(hook(stdinTui(amb.dir, args)), /não reconhecida/);
  const rs = respostas(amb);
  assert.equal(rs.length, 1);
  assert.deepEqual(rs[0].dados, { pergunta: 'loop:1', sha256: sha(args), chars: [...args].length });
  assert.equal(Object.hasOwn(rs[0].dados, 'rotulo'), false);
  assert.equal(Object.hasOwn(rs[0].dados, 'texto'), false);
  assert.ok(!Object.values(amb.bytes()).some((b) => b.includes('SENTINELA')), 'a sentinela não está em nenhum byte do diário');
  assert.ok(!existsSync(join(amb.dir, '.harness', 'SENTINELA')), 'nada de arquivo novo');
  // resposta digitada (2ª palavra não é número) idem; e o hash não fecha: o botão ainda grava
  const dig = comDuvida();
  bloqueou(hook(stdinTui(dig.dir, 'loop:1 sim SENTINELA-2')), /não reconhecida/);
  assert.ok(!Object.values(dig.bytes()).some((b) => b.includes('SENTINELA')));
  assert.deepEqual(Object.keys(respostas(dig)[0].dados).sort(), ['chars', 'pergunta', 'sha256']);
  assert.notEqual(hook(stdinTui(dig.dir, 'loop:1 1')).j?.decision, 'block');
  // pergunta que não está aberta ⇒ nem o hash entra
  const nenhuma = comDuvida();
  recusa(nenhuma, stdinTui(nenhuma.dir, 'loop:9 1 SENTINELA-3'), /inexistente/);
});

test('args-com-espaco-tab-quebra-normalizam: "loop:1  2\\n" e "\\tloop:1\\t2\\r\\n" são o botão; nunca viram hash (ataque 2)', () => {
  for (const a of ['loop:1  2\n', '\tloop:1\t2\r\n', '  loop:1 \t 2  ', 'loop:1\n2']) {
    const amb = comDuvida();
    const r = hook(stdinTui(amb.dir, a));
    assert.notEqual(r.j?.decision, 'block', `${JSON.stringify(a)}: ${r.out}`);
    assert.deepEqual(respostas(amb)[0].dados, { pergunta: 'loop:1', opcao: 2, rotulo: 'caminho beta' }, JSON.stringify(a));
  }
  // palavra a mais depois de quebra de linha continua sendo argumento a mais
  const amb = comDuvida();
  bloqueou(hook(stdinTui(amb.dir, 'loop:1 2\nSENTINELA-4')), /não reconhecida/);
  assert.deepEqual(Object.keys(respostas(amb)[0].dados).sort(), ['chars', 'pergunta', 'sha256']);
  // faltam palavras: nada gravado
  for (const a of ['', '   ', '\n', 'loop:1', 'loop:1  ']) {
    const v = repo();
    recusa(v, stdinTui(v.dir, a), /falta|uso/);
  }
});

test('args-grande-block-antes-de-regex: 2001 caracteres recusam sem gravar; 2000 ainda é argumento a mais (só hash)', () => {
  const amb = comDuvida();
  recusa(amb, stdinTui(amb.dir, `loop:1 1 ${'x'.repeat(1992)}`), /acima do limite de 2000/);
  const dentro = `loop:1 1 ${'x'.repeat(1991)}`;
  assert.equal(dentro.length, 2000);
  bloqueou(hook(stdinTui(amb.dir, dentro)), /não reconhecida/);
  assert.deepEqual(respostas(amb)[0].dados, { pergunta: 'loop:1', sha256: sha(dentro), chars: 2000 });
  // args que não é texto
  for (const a of [undefined, null, 5, ['loop:1', '1'], { x: 1 }]) {
    const s = stdinTui(amb.dir, a);
    if (a === undefined) delete s.command_args;
    recusa(amb, s, /inválido/);
  }
});

test('duas-sessoes-primeira-vence: a outra sessão responde entre a conferência e a gravação ⇒ a 2ª recusa respondida, só a 1ª grava (ataque 3)', async () => {
  const amb = comDuvida();
  const antes = () => {
    const r = diario.append(amb.pasta('_sem-id'), 'S-outra', { ts: ts(), autor: 't@t', sessao: 'S-outra', agente: 'orquestrador', tipo: 'dono.resposta', dados: { pergunta: 'loop:1', opcao: 3, rotulo: 'caminho gama' } });
    assert.ok(r.ok);
  };
  const saida = await decidir(JSON.stringify(stdinTui(amb.dir, 'loop:1 1')), amb.dir, { antes });
  assert.equal(saida?.decision, 'block');
  assert.match(saida.reason, /respondida/);
  assert.deepEqual(respostas(amb).map((e) => [e.sessao, e.dados.rotulo]), [['S-outra', 'caminho gama']]);
});

test('duas-sessoes-no-mesmo-instante: resposta que cai DEPOIS do append é detectada na releitura (block com as 2), sem deletar nada (limite declarado)', async () => {
  const amb = comDuvida();
  const depois = () => {
    const r = diario.append(amb.pasta('_sem-id'), 'S-outra', { ts: ts(), autor: 't@t', sessao: 'S-outra', agente: 'orquestrador', tipo: 'dono.resposta', dados: { pergunta: 'loop:1', opcao: 3, rotulo: 'caminho gama' } });
    assert.ok(r.ok);
  };
  const saida = await decidir(JSON.stringify(stdinTui(amb.dir, 'loop:1 1')), amb.dir, { depois });
  assert.equal(saida?.decision, 'block');
  assert.match(saida.reason, /recebeu 2 respostas/);
  // MINOR 7: a resposta do dono ficou gravada; a mensagem não pode dizer que foi recusada nem que nada foi gravado
  assert.doesNotMatch(saida.reason, /recusada|nada foi gravado|mais recente/i);
  assert.match(saida.reason, /Resposta gravada/);
  // a outra sessão tem ts anterior (relógio fictício do teste): ela é a 1ª na ordem do diário, não a do arquivo
  assert.match(saida.reason, /vale a primeira \(caminho gama\)/);
  assert.equal(respostas(amb).length, 2, 'nada foi apagado (R2)');
});

test('corrida-primeira-resposta-vence-na-trilha: S-dono grava GM-1, S-outra grava GM-2 depois ⇒ a trilha liga a GM-1 (sonda do revisor; MAJOR 1)', async () => {
  const amb = repo();
  amb.semear('GM-1', [['fato.medido', { chave: 'branch', fonte: 'git', valor: { nome: 'feat/GM-1-a' } }]], 'x');
  amb.semear('GM-2', [['fato.medido', { chave: 'branch', fonte: 'git', valor: { nome: 'feat/GM-2-a' } }]], 'x');
  amb.semear(null, [['fato.medido', { chave: 'branch', fonte: 'git', valor: { nome: 'main' } }]], 'S-dono');
  const ultimas = [{ id: 'GM-1', data: '2026-11-01T00:01:00.000Z' }, { id: 'GM-2', data: '2026-11-01T00:02:00.000Z' }];
  const fatos = { branch: 'main', idPadrao: IDPADRAO, specs: [], plano: null, ledger: false, gh: 'nunca', ultimas, sessao: 'S-dono' };
  const ab = perguntasAbertas(amb.eventos(null), trilhaDe(fatos, amb.eventos(null)), { sessao: 'S-dono', ultimas });
  assert.equal(ab.length, 1);
  const ops = ab[0].opcoes.map((o) => o.rotulo ?? o);
  const [i1, i2] = [ops.indexOf('GM-1') + 1, ops.indexOf('GM-2') + 1];
  assert.ok(i1 > 0 && i2 > 0);
  // ts depois do relógio real do hook: a ordem do diário é por ts, e a 2ª sessão grava DEPOIS da 1ª
  const depois = () => {
    const r = diario.append(amb.pasta('_sem-id'), 'S-outra', { ts: new Date(Date.now() + 5).toISOString(), autor: 't@t', sessao: 'S-outra', agente: 'orquestrador', tipo: 'dono.resposta', dados: { pergunta: ab[0].id, opcao: i2, rotulo: 'GM-2' } });
    assert.ok(r.ok);
  };
  const saida = await decidir(JSON.stringify(stdinTui(amb.dir, `${ab[0].id} ${i1}`)), amb.dir, { depois });
  assert.equal(saida?.decision, 'block');
  assert.match(saida.reason, /vale a primeira \(GM-1\)/);
  assert.deepEqual(respostas(amb).map((e) => [e.sessao, e.dados.rotulo]), [['S-dono', 'GM-1'], ['S-outra', 'GM-2']]);
  assert.equal(trilhaDe(fatos, amb.eventos(null)).entrega, 'GM-1', 'a 1ª resposta vence na projeção');
});

test('releitura-confere-a-sessao: a única resposta relida é de outra sessão com a mesma opção e rótulo ⇒ falha, não "registrada" (P4)', async () => {
  const amb = comDuvida();
  const antes = () => {}; // sem corrida: a "minha" resposta é trocada por uma de outra sessão logo após gravar
  const depois = () => {
    const f = join(amb.pasta('_sem-id'), 'events.S-dono.jsonl');
    const linhas = readFileSync(f, 'utf8').split('\n').filter((l) => l !== '');
    const ult = JSON.parse(linhas.pop());
    ult.sessao = 'S-intrusa';
    writeFileSync(f, `${[...linhas, JSON.stringify(ult)].join('\n')}\n`);
  };
  const saida = await decidir(JSON.stringify(stdinTui(amb.dir, 'loop:1 1')), amb.dir, { antes, depois });
  assert.equal(saida?.decision, 'block');
  assert.match(saida.reason, /resposta_sem_efeito|releitura não mostra/);
});

test('stdin-ausente-x-nao-json: sem stdin, não JSON, array e escalar bloqueiam; outro comando sai calado sem gravar', () => {
  const amb = comDuvida();
  for (const [entrada, causa] of [['', /ausente/], ['   \n', /ausente/], ['isto não é json', /não é JSON/], ['[]', /objeto/], ['"x"', /objeto/], ['null', /objeto/], ['5', /objeto/]]) {
    recusa(amb, entrada, causa);
  }
  const antes = amb.bytes();
  for (const nome of ['gabarito-mestre:aprovar', 'gabarito-mestre:responderx', 'Gabarito-Mestre:responder', undefined]) {
    const r = hook(stdinTui(amb.dir, 'loop:1 1', { command_name: nome }));
    assert.equal(r.rc, 0);
    assert.equal(r.out, '', `silêncio para ${nome}`);
  }
  assert.deepEqual(amb.bytes(), antes);
  // fora de repositório: block, nunca sucesso
  const fora = realpathSync(mkdtempSync(join(tmpdir(), 'responder-fora-')));
  bloqueou(hook(stdinTui(fora, 'loop:1 1')), /repositório/);
});

test('diario-ilegivel-block-ausente-nao: diário corrompido ⇒ block sem gravar; diário ausente só não acha a pergunta', () => {
  const amb = comDuvida();
  writeFileSync(join(amb.pasta('_sem-id'), 'events.S-x.jsonl'), 'isto nao e json\n');
  recusa(amb, stdinTui(amb.dir, 'loop:1 1'), /diario_ilegivel/);
  const vazio = repo();
  recusa(vazio, stdinTui(vazio.dir, 'loop:1 1'), /inexistente/);
});

test('botao-do-depende-responde (P9): dependeDe real ⇒ comando do botão ⇒ hook ⇒ perguntasAbertas sem a pergunta, e a pendência some do depende', () => {
  const amb = repo();
  amb.semear(null, [['nota', { tipo: 'pendencia', texto: 'Mandar o contrato ao jurídico' }]], 'loop', 'dono');
  const fatos = { branch: 'main', idPadrao: IDPADRAO, specs: [], plano: null, ledger: false, gh: 'nunca', ultimas: [], sessao: 'S-dono' };
  const ler = () => diario.ler(amb.pasta('_sem-id'));
  const depende = () => dependeDe(trilhaDe(fatos, ler()), ler(), [], { falhou: [] }, false, { branch: 'main', idPadrao: IDPADRAO });
  const item = depende().find((i) => i.acoes.some((a) => a.comando.startsWith('/gabarito-mestre:responder')));
  assert.ok(item, 'o depende traz a pendência com o botão');
  const comando = item.acoes[0].comando;
  assert.equal(comando, '/gabarito-mestre:responder loop:1 1');
  const [nome, ...resto] = comando.slice(1).split(' ');
  assert.equal(nome, COMANDO);
  const r = hook(stdinTui(amb.dir, resto.join(' ')));
  assert.notEqual(r.j?.decision, 'block', r.out);
  assert.deepEqual(respostas(amb)[0].dados, { pergunta: 'loop:1', opcao: 1, rotulo: 'feito' });
  const t = trilhaDe(fatos, ler());
  assert.deepEqual(perguntasAbertas(ler(), t, { sessao: 'S-dono' }).map((p) => p.id), []);
  assert.ok(!depende().some((i) => i.acoes.some((a) => a.comando.startsWith('/gabarito-mestre:responder'))), 'o botão sumiu do depende');
  // o mesmo botão de novo: respondida
  recusa(amb, stdinTui(amb.dir, resto.join(' ')), /respondida/);
});

test('botao-ideias-visto-responde (P9, T13b): botão do item 4 ⇒ hook real ⇒ item some; ideia nova volta contando só as novas', () => {
  const amb = repo();
  const nota = (tipo, texto) => ['nota', { tipo, texto }];
  amb.semear(null, [nota('desvio', 'abre a sessão'), nota('ideia', 'usar cores'), nota('ideia', 'outra ideia')], 'loop', 'dono');
  const fatos = { branch: 'main', idPadrao: IDPADRAO, specs: [], plano: null, ledger: false, gh: 'nunca', ultimas: [], sessao: 'S-dono' };
  const ler = () => diario.ler(amb.pasta('_sem-id'));
  const depende = () => dependeDe(trilhaDe(fatos, ler()), ler(), [], { falhou: [] }, false, { branch: 'main', idPadrao: IDPADRAO });
  const ideias = () => depende().find((i) => /ideia/.test(i.motivo));
  const abertas = () => perguntasAbertas(ler(), trilhaDe(fatos, ler()), { sessao: 'S-dono' }).filter((p) => p.gatilho === 'ideia');
  assert.equal(ideias().motivo, 'decidir se as 2 ideias viram a próxima entrega');
  assert.equal(abertas().length, 1);
  const comando = ideias().acoes[0].comando;
  assert.equal(comando, '/gabarito-mestre:responder loop:3 1');
  const args = comando.split(' ').slice(1).join(' ');
  const r = hook(stdinTui(amb.dir, args));
  assert.notEqual(r.j?.decision, 'block', r.out);
  assert.deepEqual(respostas(amb)[0].dados, { pergunta: 'loop:3', opcao: 1, rotulo: 'visto' });
  assert.equal(ideias(), undefined, 'o item 4 sumiu do depende');
  assert.deepEqual(abertas(), [], 'a pergunta fechou');
  recusa(amb, stdinTui(amb.dir, args), /respondida/);
  // ideia nova depois do visto: volta contando só as novas, com o botão da nova
  // o hook grava com o relógio real: a ideia nova leva um ts depois da resposta
  const g = diario.append(amb.pasta('_sem-id'), 'loop', { ts: new Date(Date.now() + 1).toISOString(), autor: 't@t', sessao: 'loop', agente: 'dono', tipo: 'nota', dados: { tipo: 'ideia', texto: 'terceira ideia' } }); // T35 (r.13): autoria fora do orquestrador
  assert.ok(g.ok && g.gravado === 'evento', JSON.stringify(g));
  assert.equal(ideias().motivo, 'decidir se a ideia vira a próxima entrega');
  assert.equal(ideias().acoes[0].comando, '/gabarito-mestre:responder loop:4 1');
  const r2 = hook(stdinTui(amb.dir, 'loop:4 1'));
  assert.notEqual(r2.j?.decision, 'block', r2.out);
  assert.equal(ideias(), undefined);
  assert.equal(respostas(amb).length, 2);
});

test('contexto-ultimas-no-hook: pergunta (a) mostra a última entrega nas opções; o hook usa as mesmas opções do painel (pendência T12)', () => {
  const amb = repo();
  amb.semear('GM-9', [['nota', { tipo: 'desvio', texto: 'atividade antiga' }]]);
  amb.semear(null, [['nota', { tipo: 'assunto', texto: 'agora outro assunto' }]], 'S-nota');
  // opções do painel: [GM-9, ideia para a próxima, conversa avulsa]
  const r = hook(stdinTui(amb.dir, 'S-nota:1 1'));
  assert.notEqual(r.j?.decision, 'block', r.out);
  assert.deepEqual(respostas(amb)[0].dados, { pergunta: 'S-nota:1', opcao: 1, rotulo: 'GM-9' });
  // congelada pela âncora: atividade de OUTRA entrega depois da nota não entra nas opções (ctx.ultimas com data; M-T14c)
  const congelada = repo();
  congelada.semear('GM-9', [['nota', { tipo: 'desvio', texto: 'atividade antiga' }]]);
  congelada.semear(null, [['nota', { tipo: 'assunto', texto: 'agora outro assunto' }]], 'S-nota');
  congelada.semear('GM-10', [['nota', { tipo: 'desvio', texto: 'atividade DEPOIS da pergunta' }]]);
  assert.notEqual(hook(stdinTui(congelada.dir, 'S-nota:1 1')).j?.decision, 'block');
  assert.equal(respostas(congelada)[0].dados.rotulo, 'GM-9');
  const outro = repo();
  outro.semear('GM-9', [['nota', { tipo: 'desvio', texto: 'atividade antiga' }]]);
  outro.semear(null, [['nota', { tipo: 'assunto', texto: 'agora outro assunto' }]], 'S-nota');
  assert.notEqual(hook(stdinTui(outro.dir, 'S-nota:1 3')).j?.decision, 'block');
  assert.equal(respostas(outro)[0].dados.rotulo, 'conversa avulsa');
  const so = repo();
  so.semear(null, [['nota', { tipo: 'assunto', texto: 'agora outro assunto' }]], 'S-nota');
  recusa(so, stdinTui(so.dir, 'S-nota:1 4'), /opcao_fora/);
});

test('contexto-sessao-no-hook: pergunta (b) só abre para a sessão do stdin (session_id); outra sessão não a responde', () => {
  const amb = repo();
  amb.semear(null, [['fato.medido', { chave: 'branch', fonte: 'git', valor: { nome: 'main' } }]], 'S-dono');
  const r = hook(stdinTui(amb.dir, 'S-dono:1 2'));
  assert.notEqual(r.j?.decision, 'block', r.out);
  assert.deepEqual(respostas(amb)[0].dados, { pergunta: 'S-dono:1', opcao: 2, rotulo: 'conversa avulsa' });
  const outra = repo();
  outra.semear(null, [['fato.medido', { chave: 'branch', fonte: 'git', valor: { nome: 'main' } }]], 'S-dono');
  recusa(outra, stdinTui(outra.dir, 'S-dono:1 2', { session_id: 'S-intrusa' }), /inexistente/);
});

test('spec-ambigua-c-usa-as-specs-do-repo: com 2 specs da entrega a pergunta (c) abre e o rótulo é o título da spec escolhida', () => {
  const amb = repo({ branch: 'enabler/GM-10-x' });
  amb.spec('a.md', '# Spec Alfa\n\nPBI: GM-10\n\n## s1\n');
  amb.spec('b.md', '# Spec Beta\n\nPBI: GM-10\n\n## s1\n');
  const h = 'a'.repeat(64);
  amb.semear('GM-10', [
    ['fato.medido', { chave: 'spec', fonte: 'arquivo', valor: { caminho: 'docs/superpowers/specs/a.md', sha256: h, secoes: 1 } }],
    ['fato.medido', { chave: 'spec', fonte: 'arquivo', valor: { caminho: 'docs/superpowers/specs/b.md', sha256: h, secoes: 1 } }],
  ], 'S-med');
  const r = hook(stdinTui(amb.dir, 'S-med:2 2'));
  assert.notEqual(r.j?.decision, 'block', r.out);
  assert.deepEqual(respostas(amb, 'GM-10')[0].dados, { pergunta: 'S-med:2', opcao: 2, rotulo: 'Spec Beta' });
});

test('pbi-so-nas-primeiras-15-linhas: PBI citado na linha 20 de uma spec não a torna da entrega, logo não há ambiguidade nem pergunta (c) (P6)', () => {
  const amb = repo({ branch: 'enabler/GM-10-x' });
  amb.spec('a.md', '# Spec Alfa\n\nPBI: GM-10\n\n## s1\n');
  amb.spec('b.md', `# Spec Beta\n${'\n'.repeat(18)}PBI: GM-10\n\n## s1\n`);
  const h = 'a'.repeat(64);
  amb.semear('GM-10', [
    ['fato.medido', { chave: 'spec', fonte: 'arquivo', valor: { caminho: 'docs/superpowers/specs/a.md', sha256: h, secoes: 1 } }],
    ['fato.medido', { chave: 'spec', fonte: 'arquivo', valor: { caminho: 'docs/superpowers/specs/b.md', sha256: h, secoes: 1 } }],
  ], 'S-med');
  const antes = amb.bytes();
  const r = hook(stdinTui(amb.dir, 'S-med:2 2'));
  assert.equal(r.j?.decision, 'block', r.out);
  assert.deepEqual(amb.bytes(), antes, 'nada gravado: a pergunta (c) não abriu');
});

test('worktree-e-caminho-com-espaco: do worktree da entrega o hook grava no diário da raiz principal, pela branch do worktree; raiz com espaço no caminho', () => {
  const pai = realpathSync(mkdtempSync(join(tmpdir(), 'responder-esp-')));
  const raiz = join(pai, 'meu projeto');
  mkdirSync(raiz);
  git(raiz, 'init', '-q', '-b', 'main');
  git(raiz, 'commit', '-q', '--allow-empty', '-m', 'chore: base');
  const wt = join(pai, 'wt GM-10');
  assert.equal(git(raiz, 'worktree', 'add', '-q', '-b', 'enabler/GM-10-wt', wt).status, 0);
  const entrega = join(raiz, '.harness', 'entregas', 'GM-10');
  mkdirSync(entrega, { recursive: true });
  assert.ok(diario.append(entrega, 'loop', { ts: ts(), autor: 't@t', sessao: 'loop', agente: 'orquestrador', tipo: 'nota', dados: { tipo: 'duvida', texto: 'Qual?', opcoes: ['um aqui', 'dois aqui'] } }).ok);
  // da raiz principal em `main` a pergunta (do diário de GM-10) não é procurada: a branch não tem o ID
  const daRaiz = hook(stdinTui(raiz, 'loop:1 2'));
  assert.equal(daRaiz.j?.decision, 'block');
  assert.match(daRaiz.j.reason, /inexistente/);
  const r = hook(stdinTui(wt, 'loop:1 2'));
  assert.notEqual(r.j?.decision, 'block', r.out);
  assert.deepEqual(diario.ler(entrega).filter((e) => e.tipo === 'dono.resposta').map((e) => e.dados), [{ pergunta: 'loop:1', opcao: 2, rotulo: 'dois aqui' }]);
  assert.equal(existsSync(join(wt, '.harness')), false, 'nada gravado dentro do worktree');
});

const PLUGIN = join(AQUI, '..', '..');

test('hooks-json-matcher-real-responder: matcher casa só gabarito-mestre:responder; onFailure block, timeout 10, comando do responder.mjs (P1/P3)', () => {
  const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8'));
  const grupos = hooks.hooks.UserPromptExpansion.filter((g) => /responder\.mjs/.test(JSON.stringify(g)));
  assert.equal(grupos.length, 1);
  const g = grupos[0];
  assert.equal(g.matcher, '^gabarito-mestre:responder$');
  const re = new RegExp(g.matcher);
  assert.equal(re.test(COMANDO), true);
  for (const n of ['gabarito-mestre:responder2', 'gabarito-mestre:aprovar', 'gabarito-mestre:emenda', 'gabarito-mestre:liberar', 'x-gabarito-mestre:responder', 'responder', '']) assert.equal(re.test(n), false, n);
  assert.equal(g.hooks.length, 1);
  assert.equal(g.hooks[0].type, 'command');
  assert.equal(g.hooks[0].onFailure, 'block');
  assert.equal(g.hooks[0].timeout, 10);
  assert.equal(g.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/gates/scripts/responder.mjs"');
  assert.ok(existsSync(HOOK));
});

test('skill-responder-frontmatter: só do dono (disable-model-invocation: true), com argumento, sem Write/Edit (P2)', () => {
  const t = readFileSync(join(PLUGIN, 'skills', 'responder', 'SKILL.md'), 'utf8');
  const cab = /^---\n([\s\S]*?)\n---/.exec(t)?.[1] ?? '';
  assert.match(cab, /^name: responder$/m);
  assert.match(cab, /^disable-model-invocation: true$/m);
  assert.match(cab, /^description: .+/m);
  assert.match(cab, /^argument-hint: <pergunta> <n>$/m);
  assert.doesNotMatch(cab, /allowed-tools:.*(Write|Edit)/);
});

// ---- GM-15 T35 (D-G11 b, D-G12 2 e 4): "agora não" e o lote das recomendadas, pelo MESMO hook ----
test('responder-agora-nao-adia-pergunta (r.14): `<id> agora` grava {pergunta, opcao 1, rotulo "agora não"} e a pergunta sai das abertas sem fechar; 2ª vez recusa', () => {
  const amb = comDuvida();
  const r = hook(stdinTui(amb.dir, 'loop:1 agora'));
  assert.equal(r.rc, 0, r.err);
  assert.equal(r.j?.systemMessage, 'Resposta registrada: agora não.', r.out);
  assert.deepEqual(respostas(amb).map((e) => e.dados), [{ pergunta: 'loop:1', opcao: 1, rotulo: 'agora não' }]);
  const eventos = diario.ler(amb.pasta('_sem-id'));
  const t = trilhaDe({ branch: 'main', idPadrao: IDPADRAO, specs: [], plano: null, ledger: false, gh: 'nunca', ultimas: [], sessao: 'S-dono' }, eventos);
  assert.deepEqual(perguntasAbertas(eventos, t, { sessao: 'S-dono' }), []);
  recusa(amb, stdinTui(amb.dir, 'loop:1 agora'), /inexistente|respondida/);
  recusa(amb, stdinTui(amb.dir, 'loop:1 agora', { agent_id: 'a1' }), /agent_id/);
});

test('responder-agora-nao-no-pouso (r.9): o pedido de /clear da sessão (medida em 55 %) é adiado com o contexto no rótulo; sem medição recusa', () => {
  const amb = repo();
  amb.semear(null, [['review.veredito', { task: 'T1', veredito: 'APROVADO', rodada: 1, blocker: 0, major: 0 }]]);
  amb.semear(null, [['sessao.pouso', { percent: 55, x: 50, via: 'dono' }]], 'S-dono');
  const pouso = amb.eventos(null).find((e) => e.tipo === 'sessao.pouso');
  const id = `${pouso.sessao}:${pouso.seq}`;
  recusa(amb, stdinTui(amb.dir, `${id} agora`), /inexistente/); // sem leitura própria não há pedido (r.12)
  mkdirSync(join(amb.dir, '.harness', 'contexto'), { recursive: true });
  writeFileSync(join(amb.dir, '.harness', 'contexto', 'S-dono.json'), JSON.stringify({ percent: 55, fonte: 'mod', em: new Date().toISOString() }));
  const r = hook(stdinTui(amb.dir, `${id} agora`));
  assert.equal(r.j?.systemMessage, 'Resposta registrada: agora não (loop parado, contexto em 55 %).', r.out);
  assert.deepEqual(respostas(amb).map((e) => e.dados), [{ pergunta: id, opcao: 1, rotulo: 'agora não (loop parado, contexto em 55 %)' }]);
  recusa(amb, stdinTui(amb.dir, `${id} agora`), /inexistente/); // já adiado
});

/** Repo com 3 dúvidas em `_sem-id`: 2 com recomendação (ids loop:1 e loop:3), 1 sem (loop:2). */
function comRecomendadas() {
  const amb = repo();
  amb.semear(null, [
    duvida('Emenda 13: aprovar?', ['aprovar (recomendado)', 'rejeitar']),
    duvida('Qual caminho?', ['alfa', 'beta']),
    duvida('Meta da previsão?', ['manter 15 %', 'aceitar 30 % (recomendado)']),
  ]);
  return amb;
}

test('lote-pede-confirmacao (r.16): `lote` não grava nada; devolve quantas, 1 linha de cada e o comando de confirmar com a impressão do lote', () => {
  const amb = comRecomendadas();
  const antes = amb.bytes();
  const r = hook(stdinTui(amb.dir, 'lote'));
  bloqueou(r, /2 perguntas com recomendação/);
  assert.match(r.j.reason, /Emenda 13: aprovar\? ⇒ aprovar \(recomendado\)/);
  assert.match(r.j.reason, /Meta da previsão\? ⇒ aceitar 30 % \(recomendado\)/);
  assert.doesNotMatch(r.j.reason, /Qual caminho/);
  assert.match(r.j.reason, /\/gabarito-mestre:responder lote [0-9a-f]{12}/);
  assert.deepEqual(amb.bytes(), antes);
});

test('lote-grava-uma-resposta-por-item (r.16, C6): a confirmação grava 1 dono.resposta por recomendada, com o rótulo recomendado; impressão velha e subagent recusam', () => {
  const amb = comRecomendadas();
  const imp = /lote ([0-9a-f]{12})/.exec(hook(stdinTui(amb.dir, 'lote')).j.reason)[1];
  recusa(amb, stdinTui(amb.dir, 'lote 000000000000'), /mudou/);
  recusa(amb, stdinTui(amb.dir, `lote ${imp}`, { agent_id: 'a1' }), /agent_id/);
  const r = hook(stdinTui(amb.dir, `lote ${imp}`));
  assert.equal(r.j?.systemMessage, 'Respostas registradas: 2 recomendadas.', r.out);
  assert.deepEqual(respostas(amb).map((e) => e.dados), [
    { pergunta: 'loop:1', opcao: 1, rotulo: 'aprovar (recomendado)' },
    { pergunta: 'loop:3', opcao: 2, rotulo: 'aceitar 30 % (recomendado)' },
  ]);
  const eventos = diario.ler(amb.pasta('_sem-id'));
  const t = trilhaDe({ branch: 'main', idPadrao: IDPADRAO, specs: [], plano: null, ledger: false, gh: 'nunca', ultimas: [], sessao: 'S-dono' }, eventos);
  assert.deepEqual(perguntasAbertas(eventos, t, { sessao: 'S-dono' }).map((p) => p.id), ['loop:2']);
  recusa(amb, stdinTui(amb.dir, `lote ${imp}`), /mudou|nenhuma/);
});

/**
 * GM-15 T26: a skill `gabarito-loop` ensina o que a 2.1.0 mudou no loop (REQ-CI-1, REQ-POU-3, REQ-POU-4, REQ-ENT-2, REQ-EME-3, REQ-AUT-1).
 * Onde dá, o teste liga o texto da skill ao comportamento: a lista de ações vem de `AcaoLoop` (tipos.ts), o comando de `anotar` que a skill
 * ensina RODA contra o `loop.mjs` real e o item aparece nas perguntas do dono, a mensagem de recusa citada é a que `validarProposta` devolve.
 *
 * MUTAÇÕES (cada uma derruba o teste nomeado):
 *  K1 tirar o bullet `retomar` do Ciclo ⇒ skill-ensina-toda-acao-do-proxima
 *  K2 tirar o `anotar --tipo duvida` do item_do_dono ⇒ sem-fonte-vira-item-do-dono-pela-skill
 *  K3 trocar `--opcao` por `--opcoes` no comando ensinado ⇒ sem-fonte-vira-item-do-dono-pela-skill (rc 2, nada gravado)
 *  K4 tirar a leitura da CI da main antes de "entregue" ⇒ skill-ci-da-main-antes-de-entregue
 *  K5 pedir `/clear` sem a condição do wakeup ⇒ skill-clear-so-com-wakeup
 *  K6 tirar o pedido do `/loop` na 1ª mensagem ⇒ skill-loop-dinamico-na-1a-mensagem
 *  K7 citar outra recusa da redação da Sombra ⇒ skill-emenda-ancora-e-redacao-da-sombra
 *  K8 tirar o `lote` do Ciclo ⇒ skill-lote-do-dono-em-1-mensagem
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { raizSegura } from './_raiz-segura.mjs';
import * as diario from '../dist/diario.js';
import { perguntasAbertas } from '../dist/perguntas.js';
import { projetarEmendas, validarProposta, SESSAO_EMENDAS } from '../dist/emenda.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const GATES = join(AQUI, '..');
const SKILL = readFileSync(join(GATES, '..', 'skills', 'gabarito-loop', 'SKILL.md'), 'utf8');
const LOOP = join(GATES, 'scripts', 'loop.mjs');

const raizes = [];
after(() => { for (const d of raizes) rmSync(d, { recursive: true, force: true }); });

/** Texto da seção `## <titulo>` até a próxima `## `. */
function secao(titulo) {
  const i = SKILL.indexOf(`\n## ${titulo}\n`);
  assert.ok(i >= 0, `seção ${titulo} ausente`);
  const fim = SKILL.indexOf('\n## ', i + 4);
  return SKILL.slice(i, fim < 0 ? undefined : fim);
}

/** Os `tipo` da união `AcaoLoop` em tipos.ts (a fonte das ações que `proxima` devolve). */
function tiposDeAcao() {
  const src = readFileSync(join(GATES, 'src', 'tipos.ts'), 'utf8');
  const i = src.indexOf('export type AcaoLoop =');
  const fim = src.indexOf(';\n', src.indexOf("tipo: 'concluir'", i));
  return [...src.slice(i, fim).matchAll(/\{ tipo: '([a-z_]+)'/g)].map((m) => m[1]);
}

/** Separa um comando em palavras, com aspas duplas (o que a skill escreve). */
function palavras(cmd) {
  return [...cmd.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
}

test('skill-ensina-toda-acao-do-proxima: cada tipo de AcaoLoop tem bullet no Ciclo, e `retomar` manda reabrir a task (obrigação loop 113, REQ-AUT-1)', () => {
  const tipos = tiposDeAcao();
  assert.ok(tipos.includes('retomar') && tipos.includes('concluir') && tipos.length >= 8, `AcaoLoop lida: ${tipos}`);
  const ciclo = secao('Ciclo');
  const faltam = tipos.filter((t) => !new RegExp(`\\n {3}- \`${t}[\`{]`).test(ciclo));
  assert.deepEqual(faltam, [], 'ação do proxima sem instrução na skill');
  const retomar = ciclo.split('\n').find((l) => l.startsWith('   - `retomar`'));
  assert.match(retomar, /loop\.mjs" reabrir <task>/);
  assert.match(retomar, /1 vez|uma vez/);
  assert.match(retomar, /nao_conseguiu/);
});

test('skill-lote-do-dono-em-1-mensagem: o `lote` do proxima vai ao dono de uma vez e o loop segue na ação permitida (REQ-AUT-1)', () => {
  const ciclo = secao('Ciclo');
  const linha = ciclo.split('\n').find((l) => l.includes('`lote`'));
  assert.ok(linha !== undefined, 'Ciclo sem o lote do proxima');
  assert.match(linha, /uma mensagem só|1 mensagem/);
  assert.match(linha, /comando/);
  assert.match(linha, /siga a `acao`/);
});

test('sem-fonte-vira-item-do-dono-pela-skill: a recusa sem --fonte devolve item_do_dono; o anotar que a skill ensina grava a dúvida e ela aparece ao dono (loop 78, review T13 MINOR-3, REQ-ENT-2)', () => {
  const dir = raizSegura(realpathSync(mkdtempSync(join(tmpdir(), 'skill-loop-'))));
  raizes.push(dir);
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'enabler/GM-10-loop');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  g('config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'harness.config.json'), JSON.stringify({ gates: { suites: ["echo '# pass 1'"] }, loop: { slots: 1 } }));
  writeFileSync(join(dir, '.gitignore'), '.harness/entregas/\n.harness/worktrees/\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: base');
  const entregas = join(dir, '.harness', 'entregas', 'GM-10');
  mkdirSync(entregas, { recursive: true });
  writeFileSync(join(entregas, 'plano.json'), JSON.stringify({ entrega: 'GM-10', tasks: [{ id: 'T1', deps: [], arquivos: ['a.txt'] }, { id: 'T2', deps: [], arquivos: ['b.txt'] }] }));
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR))/i.test(k)) delete env[k];
  const cli = (args) => {
    const r = spawnSync(process.execPath, [LOOP, ...args], { cwd: dir, encoding: 'utf8', env });
    let j = null;
    try { j = JSON.parse(r.stdout.trim()); } catch { /* fica null */ }
    return { rc: r.status, j, out: r.stdout + r.stderr };
  };

  const recusa = cli(['adiar', 'T2', '--motivo', 'fora do recorte', '--origem', 'sombra']);
  assert.equal(recusa.rc, 2, recusa.out);
  const item = recusa.j.item_do_dono;
  assert.equal(item.acoes[0].comando, '/gabarito-mestre:adiar T2');

  // o comando que a skill ensina para o item_do_dono, preenchido com o item
  const linha = SKILL.split('\n').find((l) => l.includes('item_do_dono') && l.includes('anotar --tipo duvida'));
  assert.ok(linha !== undefined, 'a skill não ensina a levar o item_do_dono ao dono');
  const m = linha.match(/`node "\$\{CLAUDE_PLUGIN_ROOT\}\/gates\/scripts\/loop\.mjs" (anotar [^`]+)`/);
  assert.ok(m !== null, `comando de anotar ausente: ${linha}`);
  const args = palavras(m[1]).map((p) => p
    .replace('<motivo do item_do_dono>', item.motivo)
    .replace('<comando do item_do_dono>', item.acoes[0].comando)
    .replace('<id>', 'sessao-teste'));
  assert.deepEqual(args.filter((p) => /<[^>]+>/.test(p)), [], `placeholder sem preencher: ${args}`);
  const nota = cli(args);
  assert.equal(nota.rc, 0, nota.out);

  const perguntas = perguntasAbertas(diario.ler(entregas), { identificada: true });
  const p = perguntas.find((x) => x.gatilho === 'd');
  assert.ok(p !== undefined, `a dúvida não aparece ao dono: ${JSON.stringify(perguntas)}`);
  assert.equal(p.texto, item.motivo);
  assert.ok(p.opcoes.some((o) => o.includes('/gabarito-mestre:adiar T2')), JSON.stringify(p.opcoes));
});

test('skill-ensina-fora-do-alvo: adiar, cortar e reabrir pela Sombra só com --fonte; o dono pelos comandos humanos; nunca --origem dono (REQ-ENT-2)', () => {
  assert.match(SKILL, /loop\.mjs" adiar <task> --motivo <t> --origem sombra --fonte <[^`]+` \(ou `cortar` no lugar de `adiar`\)/);
  assert.match(SKILL, /loop\.mjs" reabrir <task> --origem sombra --fonte </);
  for (const c of ['adiar', 'cortar', 'reabrir']) assert.match(SKILL, new RegExp(`/gabarito-mestre:${c} <task>`), c);
  assert.match(SKILL, /`--origem dono`[^\n]*(nunca|erro)/);
});

test('skill-emenda-ancora-e-redacao-da-sombra: âncora = REQ, 2ª rejeição ⇒ a Sombra redige, redação dela rejeitada ⇒ dono (REQ-EME-3, emenda 13)', () => {
  const sec = secao('Dúvida, desvio e emenda');
  assert.match(sec, /âncora[^\n]*REQ/);
  assert.match(sec, /2ª rejeição[^\n]*emenda propor[^\n]*--origem sombra/);
  // a recusa citada na skill é a que o núcleo devolve
  const cit = sec.match(/recusa `([^`]+)`[^\n]*item_do_dono|recusa `([^`]+)`/);
  assert.ok(cit !== null, 'a skill não cita a recusa da redação da Sombra');
  const citada = cit[1] ?? cit[2];
  const ev = (seq, tipo, dados) => ({ seq, ts: new Date(Date.UTC(2026, 10, 9, 12, 0, seq)).toISOString(), autor: 'x', sessao: SESSAO_EMENDAS, agente: 'a', tipo, dados, hash_anterior: null });
  const prop = (seq, extra = {}) => ev(seq, 'emenda.proposta', { req: 'REQ-X-1', diff: 'd', fato: 'f', alternativa: 'a', evidencia: 'e', causa: 'tecnica', ...extra });
  const rej = (seq, p) => ev(seq, 'emenda.rejeitada', { proposta_seq: p, origem: 'dono' });
  const est = projetarEmendas([prop(1), prop(2), rej(3, 1), rej(4, 2), prop(5, { origem: 'sombra' }), rej(6, 5)]);
  const motivo = validarProposta({ entrega: 'GM-10', tasks: [] }, est, { req: 'REQ-X-1', diff: 'd', fato: 'f', alternativa: 'a', evidencia: 'e', causa: 'tecnica', origem: 'sombra' });
  assert.equal(motivo, citada);
  assert.match(sec, /anotar --tipo duvida/);
});

test('skill-ci-da-main-antes-de-entregue: só declara entregue lendo a CI do push na main; vermelho por ruído ⇒ rerun e item de correção (REQ-CI-1)', () => {
  const ent = secao('Entrega');
  assert.match(ent, /gh run list --branch main/);
  assert.match(ent, /gh run rerun <id> --failed/);
  assert.match(ent, /loop\.mjs" anotar --tipo desvio/);
  assert.match(ent, /nunca[^\n]*(entregue|pronto)[^\n]*sem/i);
  assert.match(ent, /X silencioso|calad/);
});

test('skill-pouso-quem-limpa-e-o-mod: aviso de "limpar a conversa" leva ao pousar e o texto ao dono diz que quem limpa é o mod (REQ-POU-3)', () => {
  const ciclo = secao('Ciclo');
  const linha = ciclo.split('\n').find((l) => l.includes('"limpar a conversa"'));
  assert.ok(linha !== undefined, 'a skill não trata o aviso de limpar a conversa');
  assert.match(linha, /loop\.mjs" pousar --sessao <id>/);
  assert.match(linha, /quem limpa é o mod/);
});

test('skill-loop-dinamico-na-1a-mensagem: a skill pede o /loop dinâmico na 1ª mensagem da entrega (REQ-POU-4, aprendizado 877)', () => {
  const linha = SKILL.split('\n').find((l) => l.includes('1ª mensagem') && l.includes('/loop'));
  assert.ok(linha !== undefined, 'a skill não pede o /loop na 1ª mensagem');
  assert.match(linha, /ligar o loop automático/);
});

test('skill-clear-so-com-wakeup: toda linha que pede /clear ao dono exige o wakeup do /loop armado antes (REQ-POU-4, aprendizado 185)', () => {
  const pedidos = SKILL.split('\n').filter((l) => /que digite `\/clear`/.test(l));
  assert.ok(pedidos.length >= 2, `pedidos de /clear achados: ${pedidos.length}`);
  for (const l of pedidos) assert.match(l, /sem o wakeup do `\/loop` armado, nunca peça `\/clear`/i, l);
});

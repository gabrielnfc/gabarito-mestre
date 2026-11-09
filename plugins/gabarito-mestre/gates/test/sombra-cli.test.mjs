/**
 * REQ-SOM-1 a SOM-4 pela borda: `sombra.mjs` (perguntar / registrar). Repositório git temporário por caso, CLI real, núcleo pelo `dist/`.
 * Costura (P9): `consulta-decisao-cache-atravessa-as-camadas` vai do CLI ao diário em disco e volta pelo CLI.
 *
 * MUTAÇÕES PRESCRITAS (cada uma tem que derrubar a suíte): task-7-mut.json da entrega.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, readdirSync, symlinkSync, renameSync, chmodSync, rmSync, appendFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as diario from '../dist/diario.js';
import { formaInvalida } from '../dist/formas.js';
import { promptSombra } from '../dist/sombra.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(AQUI, '..', 'scripts', 'sombra.mjs');
const AGENTE = join(AQUI, '..', '..', 'agents', 'gabarito-sombra.md');

const raizes = [];
const novoTmp = (prefixo) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefixo)));
  raizes.push(d);
  return d;
};
after(() => {
  for (const d of raizes) {
    try { chmodSync(join(d, '.harness', 'entregas', 'GM-10'), 0o755); } catch { /* nada */ }
  }
});

const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const SPEC = [
  '# Spec', '',
  '**REQ-A-1 Limite.** texto do REQ A1', 'segunda linha do A1', '',
  '**REQ-A-2 Outro.** texto do REQ A2', '',
  '**REQ-A-10 Dez.** texto do REQ A10', '',
].join('\n');

const PLANO = {
  entrega: 'GM-10',
  spec: 'docs/spec.md',
  tasks: [
    { id: 'T1', deps: [], arquivos: ['src/a.txt'], reqs: ['REQ-A-1', 'REQ-A-2'], mutacoes: 'MUT-NAO-VAZA', teste_afetado: 'TESTE-NAO-VAZA' },
    { id: 'T2', deps: [], arquivos: ['src/b.txt'] },
    { id: 'T3', deps: [], arquivos: ['src/c.txt'], reqs: ['REQ-Z-1'] },
  ],
};

/** Repo temporário com spec e plano; `plano`/`spec` sobrescrevem; `spec: null` não cria o arquivo. */
function novoRepo({ plano = PLANO, spec = SPEC, planoTexto } = {}) {
  const raiz = novoTmp('sombra-cli-');
  g(raiz, 'init', '-q', '-b', 'main');
  g(raiz, 'config', 'user.email', 'dev@example.com');
  g(raiz, 'config', 'user.name', 'dev');
  if (spec !== null) {
    mkdirSync(join(raiz, 'docs'), { recursive: true });
    writeFileSync(join(raiz, 'docs', 'spec.md'), spec);
  }
  const dir = join(raiz, '.harness', 'entregas', 'GM-10');
  mkdirSync(dir, { recursive: true });
  if (planoTexto !== null) writeFileSync(join(dir, 'plano.json'), planoTexto ?? JSON.stringify(plano));
  writeFileSync(join(raiz, 'README.md'), 'x');
  g(raiz, 'add', 'README.md');
  g(raiz, 'commit', '-q', '-m', 'init');
  return { raiz, dir, sombra: join(dir, 'sombra') };
}

const rodar = (cwd, args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  const linhas = r.stdout.trim().split('\n');
  assert.equal(linhas.length, 1, `uma linha de JSON em stdout, veio: ${r.stdout} / stderr: ${r.stderr}`);
  return { rc: r.status, out: JSON.parse(linhas[0]) };
};
const perguntar = (cwd, pergunta, ancora = ['--req', 'REQ-A-1'], extra = ['--entrega', 'GM-10']) => rodar(cwd, ['perguntar', ...ancora, '--pergunta', pergunta, ...extra]);

let relogio = 0;
const ts = () => new Date(Date.UTC(2026, 10, 9, 10, 0, relogio++)).toISOString();
const evento = (r, sessao, tipo, dados) => {
  const res = diario.append(join(r.raiz, '.harness', 'entregas', 'GM-10'), sessao, { ts: ts(), autor: 'x', sessao, agente: 'orquestrador', tipo, dados });
  assert.equal(res.ok, true, JSON.stringify(res));
  return res;
};
const proposta = (r, req, sessao = 'emendas') => evento(r, sessao, 'emenda.proposta', { req, diff: 'd', fato: 'f', alternativa: 'a', evidencia: 'e', causa: 'regra_negocio' });
const julgar = (r, proposta_seq) => evento(r, 'loop', 'spec.emendada', { proposta_seq, origem: 'dono' });

const eventosDe = (r) => {
  const out = [];
  for (const n of existsSync(r.dir) ? readdirSync(r.dir).filter((x) => /^events\..+\.jsonl$/.test(x)).sort() : []) {
    for (const l of readFileSync(join(r.dir, n), 'utf8').split('\n')) if (l !== '') out.push(JSON.parse(l));
  }
  return out;
};
const dosTipo = (r, tipo) => eventosDe(r).filter((e) => e.tipo === tipo);
const arquivosSombra = (r) => (existsSync(r.sombra) ? readdirSync(r.sombra).sort() : []);

let n = 0;
const respostaJson = (r, obj) => {
  const arq = join(r.raiz, `resposta-${n++}.json`);
  writeFileSync(arq, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return arq;
};
const registrar = (r, hash, obj, extra = ['--entrega', 'GM-10']) => rodar(r.raiz, ['registrar', hash, respostaJson(r, obj), ...extra]);
const BOA = { resposta: 'R curta', texto: 'texto inteiro da resposta', pergunta_enviesada: false, fontes: ['docs/spec.md:3'] };

const segredo = (prefixo, resto) => `${prefixo}${resto}`;

describe('perguntar', () => {
  test('perguntar-grava-consulta-e-brief', () => {
    const r = novoRepo();
    const { rc, out } = perguntar(r.raiz, 'Qual o limite?');
    assert.equal(rc, 0);
    assert.equal(out.ok, true);
    assert.equal(out.hash, sha256('REQ-A-1\n0\nqual o limite?'));
    assert.equal(out.brief, `.harness/entregas/GM-10/sombra/${out.hash}.md`);
    assert.equal(out.consultas, 1);
    assert.equal(out.teto, 26);
    assert.equal(out.aviso, undefined);
    assert.equal(out.cache, undefined);
    assert.equal(out.pendente, undefined);
    const consultas = dosTipo(r, 'sombra.consulta');
    assert.equal(consultas.length, 1);
    assert.deepEqual(consultas[0].dados, { pergunta_hash: out.hash, req: 'REQ-A-1' });
    const brief = readFileSync(join(r.raiz, out.brief), 'utf8');
    assert.ok(brief.includes('> Qual o limite?'));
    assert.ok(brief.includes('texto do REQ A1') && brief.includes('segunda linha do A1'));
    assert.ok(!brief.includes('texto do REQ A2') && !brief.includes('REQ A10'), 'só o trecho do REQ perguntado');
    assert.ok(brief.includes('docs/spec.md'));
  });

  test('prompt-igual-a-promptSombra', () => {
    const r = novoRepo();
    const { out } = perguntar(r.raiz, 'Qual o limite?');
    assert.equal(out.prompt, promptSombra(`.harness/entregas/GM-10/sombra/${out.hash}.md`));
    assert.equal(out.prompt, `Leia o brief em .harness/entregas/GM-10/sombra/${out.hash}.md e responda só pelo que ele manda, no formato de resposta.json do seu papel. Nada além do brief.`);
  });

  test('brief-sem-hipotese', () => {
    const r = novoRepo();
    const { out } = perguntar(r.raiz, 'acho que é X. qual o limite?', ['--task', 'T1']);
    const brief = readFileSync(join(r.raiz, out.brief), 'utf8');
    assert.equal(brief.split('acho que é X').length - 1, 1, 'a hipótese aparece uma vez, como pergunta, e só nela');
    assert.ok(brief.includes('## Task do plano') && brief.includes('- id: T1'));
    assert.ok(brief.includes('texto do REQ A1') && brief.includes('texto do REQ A2'));
    assert.ok(!brief.includes('MUT-NAO-VAZA') && !brief.includes('TESTE-NAO-VAZA'), 'campos livres da task não entram');
    assert.ok(!/transcript|diff/iu.test(brief.replace(/Instrução[\s\S]*$/u, '')), 'nada de transcript nem diff antes da instrução');
  });

  test('perguntar-task-sem-req', () => {
    const r = novoRepo();
    const { rc, out } = perguntar(r.raiz, 'e agora?', ['--task', 'T2']);
    assert.equal(rc, 0);
    assert.equal(out.hash, sha256('task:T2\n0\ne agora?'));
    assert.deepEqual(dosTipo(r, 'sombra.consulta')[0].dados, { pergunta_hash: out.hash, task: 'T2' });
    assert.ok(readFileSync(join(r.raiz, out.brief), 'utf8').includes('- id: T2'));
  });

  test('perguntar-segunda-vez-pendente', () => {
    const r = novoRepo();
    const a = perguntar(r.raiz, 'Qual o limite?').out;
    const b = perguntar(r.raiz, '  QUAL o   limite?\n');
    assert.equal(b.rc, 0);
    assert.equal(b.out.pendente, true);
    assert.equal(b.out.hash, a.hash);
    assert.equal(b.out.consultas, undefined, 'pendente não conta consulta nova');
    assert.equal(dosTipo(r, 'sombra.consulta').length, 1, 'nenhum evento novo');
  });

  test('pendente-devolve-prompt', () => {
    const r = novoRepo();
    const a = perguntar(r.raiz, 'Qual o limite?').out;
    const b = perguntar(r.raiz, 'Qual o limite?').out;
    assert.equal(b.prompt, a.prompt);
    assert.equal(b.prompt, promptSombra(`.harness/entregas/GM-10/sombra/${a.hash}.md`));
    assert.equal(b.brief, a.brief);
  });

  test('pendente-reescreve-brief-ausente', () => {
    const r = novoRepo();
    const a = perguntar(r.raiz, 'Qual o limite?').out;
    const antes = readFileSync(join(r.raiz, a.brief), 'utf8');
    rmSync(join(r.raiz, a.brief));
    const b = perguntar(r.raiz, 'Qual o limite?');
    assert.equal(b.out.pendente, true);
    assert.equal(readFileSync(join(r.raiz, b.out.brief), 'utf8'), antes, 'mesmo conteúdo');
    assert.equal(dosTipo(r, 'sombra.consulta').length, 1);
  });

  test('pendente-nao-sobrescreve-brief-existente', () => {
    const r = novoRepo();
    const a = perguntar(r.raiz, 'Qual o limite?').out;
    appendFileSync(join(r.raiz, a.brief), '\nMARCA-DO-TESTE\n');
    assert.equal(perguntar(r.raiz, 'Qual o limite?').out.pendente, true);
    assert.ok(readFileSync(join(r.raiz, a.brief), 'utf8').includes('MARCA-DO-TESTE'), 'brief presente não é reescrito');
  });

  test('sessao-padrao-loop-e-flag-sessao', () => {
    const r = novoRepo();
    perguntar(r.raiz, 'padrão?');
    perguntar(r.raiz, 'outra?', ['--req', 'REQ-A-1'], ['--entrega', 'GM-10', '--sessao', 'minha']);
    assert.ok(existsSync(join(r.dir, 'events.loop.jsonl')));
    assert.ok(existsSync(join(r.dir, 'events.minha.jsonl')));
    assert.equal(eventosDe(r).filter((e) => e.sessao === 'minha').length, 1);
    assert.equal(eventosDe(r).filter((e) => e.sessao === 'loop').length, 1);
  });

  test('brief-falha-depois-da-consulta-recupera', () => {
    const r = novoRepo();
    writeFileSync(r.sombra, 'arquivo no lugar da pasta'); // mkdir da pasta do brief falha
    const a = perguntar(r.raiz, 'Qual o limite?');
    assert.equal(a.rc, 1);
    assert.equal(a.out.erro, 'brief_nao_gravado');
    assert.equal(dosTipo(r, 'sombra.consulta').length, 1, 'a consulta ficou gravada');
    rmSync(r.sombra);
    const b = perguntar(r.raiz, 'Qual o limite?');
    assert.equal(b.rc, 0);
    assert.equal(b.out.pendente, true);
    assert.ok(existsSync(join(r.raiz, b.out.brief)), 'brief reescrito');
    assert.equal(dosTipo(r, 'sombra.consulta').length, 1);
  });

  test('perguntar-append-falho-nao-deixa-brief', { skip: process.getuid?.() === 0 }, () => {
    const r = novoRepo();
    mkdirSync(r.sombra); // a pasta do brief é gravável; o diário (pasta da entrega) não
    chmodSync(r.dir, 0o555);
    try {
      const a = perguntar(r.raiz, 'Qual o limite?');
      assert.equal(a.rc, 1);
      assert.equal(a.out.erro, 'evento_nao_gravado');
      assert.doesNotMatch(a.out.mensagem, /canário/, 'falha de gravação não é recusa de canário');
      assert.deepEqual(arquivosSombra(r), [], 'consulta não gravada ⇒ nenhum brief');
    } finally {
      chmodSync(r.dir, 0o755);
    }
    assert.equal(dosTipo(r, 'sombra.consulta').length, 0);
  });

  test('perguntar-vazia-recusa', () => {
    const r = novoRepo();
    const a = perguntar(r.raiz, ' \n\t ');
    assert.equal(a.rc, 1);
    assert.equal(a.out.erro, 'pergunta_vazia');
    assert.deepEqual(eventosDe(r), []);
    assert.deepEqual(arquivosSombra(r), []);
  });

  test('normaliza-caixa-espaco-quebra-nfc', () => {
    const r = novoRepo();
    const a = perguntar(r.raiz, 'Ação é isso?').out.hash;
    for (const variante of ['AÇÃO É ISSO?', 'Ação   é\tisso?', '  ação\né isso?  '.normalize('NFD')]) {
      assert.equal(perguntar(r.raiz, variante).out.hash, a, JSON.stringify(variante));
    }
    assert.notEqual(perguntar(r.raiz, 'Ação é isso??').out.hash, a);
    assert.equal(dosTipo(r, 'sombra.consulta').length, 2);
  });

  test('perguntar-segredo-recusa', () => {
    const r = novoRepo();
    const tok = segredo('gh', 'p_') + 'a'.repeat(36);
    const a = perguntar(r.raiz, `qual a regra? ${tok}`);
    assert.equal(a.rc, 1);
    assert.equal(a.out.erro, 'segredo_na_pergunta');
    assert.ok(!JSON.stringify(a.out).includes(tok), 'o segredo não é ecoado');
    assert.deepEqual(eventosDe(r), []);
    assert.deepEqual(arquivosSombra(r), [], 'nenhum brief');
  });

  test('req-fora-da-spec-recusa', () => {
    const r = novoRepo();
    const a = perguntar(r.raiz, 'x?', ['--req', 'REQ-A-9']);
    assert.equal(a.out.erro, 'req_fora_da_spec');
    assert.ok(a.out.mensagem.includes('REQ-A-9'));
    const b = perguntar(r.raiz, 'x?', ['--task', 'T3']);
    assert.equal(b.out.erro, 'req_fora_da_spec');
    assert.ok(b.out.mensagem.includes('REQ-Z-1'), 'cita o req da task sem trecho');
    const c = perguntar(r.raiz, 'x?', ['--task', 'T9']);
    assert.equal(c.out.erro, 'task_fora_do_plano');
    assert.equal(a.rc + b.rc + c.rc, 3);
    assert.deepEqual(eventosDe(r), []);
    assert.deepEqual(arquivosSombra(r), []);
  });

  test('req-a-1-nao-casa-req-a-10', () => {
    const r = novoRepo();
    const { out } = perguntar(r.raiz, 'x?', ['--req', 'REQ-A-10']);
    const brief = readFileSync(join(r.raiz, out.brief), 'utf8');
    assert.ok(brief.includes('texto do REQ A10') && !brief.includes('texto do REQ A1\n'));
  });

  test('plano-sem-spec-recusa', () => {
    const { spec, ...semSpec } = PLANO;
    const r = novoRepo({ plano: semSpec });
    const a = perguntar(r.raiz, 'x?');
    assert.equal(a.rc, 1);
    assert.equal(a.out.erro, 'plano_sem_spec');
    assert.deepEqual(eventosDe(r), []);
  });

  test('plano-ausente-x-invalido-x-entrega-nao-inferida', () => {
    assert.equal(perguntar(novoRepo({ planoTexto: null }).raiz, 'x?').out.erro, 'plano_ausente');
    assert.equal(perguntar(novoRepo({ planoTexto: '{nao é json' }).raiz, 'x?').out.erro, 'plano_invalido');
    assert.equal(perguntar(novoRepo({ plano: { entrega: 'GM-99', tasks: [] } }).raiz, 'x?').out.erro, 'plano_invalido');
    const r = novoRepo();
    assert.equal(perguntar(r.raiz, 'x?', ['--req', 'REQ-A-1'], []).out.erro, 'entrega_nao_inferida', 'branch main não traz a entrega');
  });

  test('spec-ausente-x-ilegivel', () => {
    const ausente = perguntar(novoRepo({ spec: null }).raiz, 'x?');
    assert.equal(ausente.out.erro, 'spec_ausente');
    const dir = novoRepo({ spec: null });
    mkdirSync(join(dir.raiz, 'docs', 'spec.md'), { recursive: true }); // é uma pasta: existe, mas não lê
    const ilegivel = perguntar(dir.raiz, 'x?');
    assert.equal(ilegivel.out.erro, 'spec_ilegivel');
    const fora = perguntar(novoRepo({ plano: { ...PLANO, spec: '../../x.md' } }).raiz, 'x?');
    assert.equal(fora.out.erro, 'spec_fora_da_raiz');
    assert.deepEqual([ausente.rc, ilegivel.rc, fora.rc], [1, 1, 1]);
    assert.deepEqual(eventosDe(dir), []);
  });

  test('spec-symlink-para-fora-da-raiz-recusada-sem-ler', () => {
    const r = novoRepo({ spec: null });
    const fora = novoTmp('sombra-fora-');
    const alvo = join(fora, 'externa.md');
    writeFileSync(alvo, '**REQ-A-1 L.** SEGREDO_DE_FORA_DA_RAIZ\n');
    mkdirSync(join(r.raiz, 'docs'), { recursive: true });
    symlinkSync(alvo, join(r.raiz, 'docs', 'spec.md'));
    const a = perguntar(r.raiz, 'x?');
    assert.equal(a.rc, 1);
    assert.equal(a.out.erro, 'spec_fora_da_raiz');
    assert.ok(!JSON.stringify(a.out).includes('SEGREDO_DE_FORA_DA_RAIZ'), 'o conteúdo de fora não vaza na saída');
    assert.deepEqual(eventosDe(r), []);
    assert.deepEqual(arquivosSombra(r), [], 'nenhum brief gravado');
  });

  test('diario-ausente-x-corrompido', () => {
    const limpo = novoRepo();
    assert.equal(perguntar(limpo.raiz, 'x?').rc, 0, 'sem eventos ⇒ grava');
    const r = novoRepo();
    const a = perguntar(r.raiz, 'Qual o limite?').out;
    const arq = join(r.dir, 'events.loop.jsonl');
    const linhas = readFileSync(arq, 'utf8').split('\n').filter(Boolean);
    const adulterada = JSON.parse(linhas[0]);
    adulterada.hash_anterior = 'f'.repeat(64);
    writeFileSync(arq, `${JSON.stringify(adulterada)}\n`);
    const antes = readFileSync(arq, 'utf8');
    const b = perguntar(r.raiz, 'Outra dúvida?');
    assert.equal(b.rc, 1);
    assert.equal(b.out.erro, 'diario_ilegivel');
    assert.equal(readFileSync(arq, 'utf8'), antes, 'nada gravado');
    assert.deepEqual(arquivosSombra(r), [`${a.hash}.md`], 'nenhum brief novo');
    const c = registrar(r, a.hash, BOA);
    assert.equal(c.out.erro, 'diario_ilegivel');
    appendFileSync(arq, 'não é json\n');
    assert.equal(perguntar(r.raiz, 'Outra dúvida?').out.erro, 'diario_ilegivel');
  });

  test('diario-linha-nao-json-recusa', () => {
    const r = novoRepo();
    perguntar(r.raiz, 'Qual o limite?');
    appendFileSync(join(r.dir, 'events.loop.jsonl'), 'não é json\n');
    const b = perguntar(r.raiz, 'Outra dúvida?');
    assert.equal(b.rc, 1);
    assert.equal(b.out.erro, 'diario_ilegivel');
    assert.match(b.out.mensagem, /não é JSON/);
    assert.deepEqual(arquivosSombra(r).length, 1, 'nenhum brief novo');
  });

  test('diario-ordenar-falho-recusa', () => {
    const r = novoRepo();
    // seq 2 e depois 1 na mesma sessão, com a cadeia de hash íntegra: lê, mas não ordena
    const l1 = JSON.stringify({ seq: 2, ts: '2026-11-09T10:00:00.000Z', autor: 'x', sessao: 'loop', agente: 'o', tipo: 'ci.resultado', dados: { verde: true }, hash_anterior: null });
    const l2 = JSON.stringify({ seq: 1, ts: '2026-11-09T10:00:01.000Z', autor: 'x', sessao: 'loop', agente: 'o', tipo: 'ci.resultado', dados: { verde: true }, hash_anterior: sha256(l1) });
    writeFileSync(join(r.dir, 'events.loop.jsonl'), `${l1}\n${l2}\n`);
    const a = perguntar(r.raiz, 'x?');
    assert.equal(a.rc, 1);
    assert.equal(a.out.erro, 'diario_invalido');
    assert.deepEqual(arquivosSombra(r), []);
    assert.equal(readFileSync(join(r.dir, 'events.loop.jsonl'), 'utf8'), `${l1}\n${l2}\n`);
    const hash = sha256('qualquer');
    assert.equal(registrar(r, hash, BOA).out.erro, 'diario_invalido');
  });

  test('versao-task-ultima-aprovada-nao-maior', () => {
    const r = novoRepo();
    for (const req of ['REQ-A-2', 'REQ-A-2', 'REQ-A-2', 'REQ-A-1', 'REQ-A-1']) proposta(r, req); // seq 1..5
    julgar(r, 5); // A-1 aprovada com seq 5
    const a = perguntar(r.raiz, 'x?', ['--task', 'T1']).out;
    assert.equal(a.hash, sha256('task:T1\n5\nx?'));
    assert.equal(registrar(r, a.hash, BOA).rc, 0);
    assert.equal(perguntar(r.raiz, 'x?', ['--task', 'T1']).out.cache, true);
    julgar(r, 3); // A-2 aprovada depois, com proposta mais antiga: a última julgada é 3, o máximo continua 5
    const b = perguntar(r.raiz, 'x?', ['--task', 'T1']);
    assert.equal(b.out.cache, undefined, 'sem cache velho');
    assert.equal(b.out.hash, sha256('task:T1\n3\nx?'));
    assert.notEqual(b.out.hash, a.hash);
  });

  test('cache-invalida-apos-spec-emendada', () => {
    const r = novoRepo();
    const a = perguntar(r.raiz, 'Qual o limite?').out;
    registrar(r, a.hash, BOA);
    assert.equal(perguntar(r.raiz, 'Qual o limite?').out.cache, true);
    proposta(r, 'REQ-A-1');
    julgar(r, 1);
    const b = perguntar(r.raiz, 'Qual o limite?');
    assert.equal(b.out.cache, undefined);
    assert.equal(b.out.hash, sha256('REQ-A-1\n1\nqual o limite?'));
    assert.equal(b.out.consultas, 2);
    assert.ok(readFileSync(join(r.raiz, b.out.brief), 'utf8').includes('Emenda aprovada #1 (REQ-A-1)'), 'a emenda aprovada entra no brief');
    // emenda de outro REQ não invalida
    proposta(r, 'REQ-A-2');
    julgar(r, 2);
    assert.equal(perguntar(r.raiz, 'Qual o limite?').out.hash, b.out.hash);
  });

  test('perguntar-de-worktree-grava-no-principal', () => {
    const r = novoRepo();
    const wt = join(r.raiz, '.harness', 'worktrees', 'T1');
    g(r.raiz, 'worktree', 'add', '-q', '-b', 'wt/GM-10-T1', wt);
    const { rc, out } = rodar(wt, ['perguntar', '--req', 'REQ-A-1', '--pergunta', 'Qual o limite?']);
    assert.equal(rc, 0, JSON.stringify(out));
    assert.equal(dosTipo(r, 'sombra.consulta').length, 1, 'diário da raiz principal');
    assert.ok(existsSync(join(r.raiz, out.brief)));
    assert.ok(!existsSync(join(wt, '.harness', 'entregas')), 'nada na worktree');
  });

  test('prompt-caminho-literal-sob-symlink', () => {
    const r = novoRepo();
    // (a) raiz alcançada por symlink (macOS: /var → /private/var)
    const elo = join(novoTmp('sombra-elo-'), 'elo');
    symlinkSync(r.raiz, elo);
    const a = perguntar(elo, 'Qual o limite?');
    assert.equal(a.out.prompt, promptSombra(`.harness/entregas/GM-10/sombra/${a.out.hash}.md`));
    // (b) `.harness` é um symlink para outra pasta: o caminho continua o literal, nunca o `relative` do realpath
    const r2 = novoRepo();
    const real = join(novoTmp('sombra-real-'), 'h');
    renameSync(join(r2.raiz, '.harness'), real);
    symlinkSync(real, join(r2.raiz, '.harness'));
    const b = perguntar(r2.raiz, 'Qual o limite?');
    assert.equal(b.rc, 0, JSON.stringify(b.out));
    assert.equal(b.out.brief, `.harness/entregas/GM-10/sombra/${b.out.hash}.md`);
    assert.equal(b.out.prompt, promptSombra(`.harness/entregas/GM-10/sombra/${b.out.hash}.md`));
    const c = perguntar(r2.raiz, 'Qual o limite?');
    assert.equal(c.out.brief, b.out.brief, 'o pendente também devolve o literal');
    assert.equal(c.out.prompt, b.out.prompt);
  });

  test('pergunta-que-comeca-com-dois-hifens', () => {
    const r = novoRepo();
    const a = perguntar(r.raiz, '--e se for zero?');
    assert.equal(a.rc, 0);
    assert.equal(a.out.hash, sha256('REQ-A-1\n0\n--e se for zero?'));
  });

  test('teto-invalido-26-com-aviso', () => {
    // sem origin: ausente ⇒ 26 sem aviso
    const sem = novoRepo();
    const s = perguntar(sem.raiz, 'x?').out;
    assert.equal(s.teto, 26);
    assert.equal(s.aviso, undefined);
    // com origin: teto inválido ⇒ 26 e aviso; válido ⇒ o valor; JSON corrompido ⇒ 26 e aviso
    const comOrigin = (cfg) => {
      const r = novoRepo();
      writeFileSync(join(r.raiz, 'harness.config.json'), cfg);
      g(r.raiz, 'add', 'harness.config.json');
      g(r.raiz, 'commit', '-q', '-m', 'cfg');
      const bare = join(novoTmp('sombra-bare-'), 'o.git');
      execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
      g(r.raiz, 'remote', 'add', 'origin', bare);
      g(r.raiz, 'push', '-q', 'origin', 'main');
      g(r.raiz, 'remote', 'set-head', 'origin', 'main');
      return r;
    };
    const inv = perguntar(comOrigin('{"sombra":{"teto":"muitos"}}').raiz, 'x?').out;
    assert.equal(inv.teto, 26);
    assert.match(inv.aviso, /teto/);
    const ok = perguntar(comOrigin('{"sombra":{"teto":3}}').raiz, 'x?').out;
    assert.equal(ok.teto, 3);
    assert.equal(ok.aviso, undefined);
    const quebrado = perguntar(comOrigin('{nao json').raiz, 'x?').out;
    assert.equal(quebrado.teto, 26);
    assert.match(quebrado.aviso, /origin/);
    const zero = perguntar(comOrigin('{"sombra":{"teto":0}}').raiz, 'x?').out;
    assert.equal(zero.teto, 26);
    assert.ok(zero.aviso);
  });

  test('acima-do-teto-segue-com-aviso', () => {
    const r = novoRepo();
    writeFileSync(join(r.raiz, 'harness.config.json'), '{"sombra":{"teto":1}}');
    g(r.raiz, 'add', 'harness.config.json');
    g(r.raiz, 'commit', '-q', '-m', 'cfg');
    const bare = join(novoTmp('sombra-bare-'), 'o.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    g(r.raiz, 'remote', 'add', 'origin', bare);
    g(r.raiz, 'push', '-q', 'origin', 'main');
    g(r.raiz, 'remote', 'set-head', 'origin', 'main');
    const a = perguntar(r.raiz, 'primeira?').out;
    assert.equal(a.consultas, 1);
    assert.equal(a.aviso, undefined, 'no teto ainda não avisa');
    const b = perguntar(r.raiz, 'segunda?');
    assert.equal(b.rc, 0, 'acima do teto a consulta segue');
    assert.equal(b.out.consultas, 2);
    assert.match(b.out.aviso, /acima do teto/);
    assert.equal(dosTipo(r, 'sombra.consulta').length, 2);
    registrar(r, a.hash, BOA);
    assert.equal(perguntar(r.raiz, 'primeira?').out.aviso, undefined, 'acerto de cache não avisa');
  });

  test('uso-e-argumento-invalido', () => {
    const r = novoRepo();
    const u = (args) => rodar(r.raiz, args);
    for (const args of [
      [], ['x'], ['perguntar', '--pergunta', 'x?'], ['perguntar', '--req', 'REQ-A-1', '--task', 'T1', '--pergunta', 'x?'], ['perguntar', '--req', 'REQ-A-1'],
      ['perguntar', '--req', 'REQ-A-1', '--pergunta', 'x?', '--flag', 'y'], ['perguntar', '--req', 'REQ-A-1', '--req', 'REQ-A-2', '--pergunta', 'x?'],
      ['perguntar', '--req'], ['registrar', 'so-um'], ['registrar', 'a', 'b', 'c'], ['perguntar', 'sobra', '--req', 'REQ-A-1', '--pergunta', 'x?'],
    ]) {
      const a = u(args);
      assert.equal(a.rc, 2, JSON.stringify(args));
      assert.equal(a.out.erro, 'uso', JSON.stringify(args));
    }
    for (const args of [
      ['perguntar', '--req', 'req-a-1', '--pergunta', 'x?'], ['perguntar', '--req', 'REQ-A-1x', '--pergunta', 'x?'], ['perguntar', '--task', '../x', '--pergunta', 'x?'],
      ['perguntar', '--req', 'REQ-A-1', '--pergunta', 'x?', '--sessao', 'a/b'], ['perguntar', '--req', 'REQ-A-1', '--pergunta', 'x?', '--entrega', 'gm-10'],
      ['registrar', 'zz', 'r.json'], ['registrar', 'A'.repeat(64), 'r.json'],
    ]) {
      const a = u(args);
      assert.equal(a.rc, 2, JSON.stringify(args));
      assert.equal(a.out.erro, 'argumento_invalido', JSON.stringify(args));
    }
    assert.deepEqual(eventosDe(r), []);
  });
});

describe('registrar', () => {
  const consulta = (r, pergunta = 'Qual o limite?', ancora) => perguntar(r.raiz, pergunta, ancora).out.hash;

  test('consulta-decisao-cache-atravessa-as-camadas', () => {
    const r = novoRepo();
    const hash = consulta(r);
    const reg = registrar(r, hash, { ...BOA, resposta: 'Limite é 10', texto: 'Limite é 10 conforme A1.\nDetalhe.', fontes: ['docs/spec.md:3', 'docs/spec.md:4'] });
    assert.equal(reg.rc, 0, JSON.stringify(reg.out));
    const evs = dosTipo(r, 'decisao.sombra');
    assert.equal(evs.length, 1);
    // o diário em disco, lido pelo núcleo real, projeta a decisão que o CLI devolve em cache
    const c = perguntar(r.raiz, 'qual o limite?');
    assert.equal(c.rc, 0);
    assert.equal(c.out.cache, true);
    assert.equal(c.out.hash, hash);
    assert.equal(c.out.decisao.resposta, 'Limite é 10');
    assert.deepEqual(c.out.decisao.fontes, ['docs/spec.md:3', 'docs/spec.md:4']);
    assert.equal(c.out.decisao.arquivo, evs[0].dados.arquivo);
    assert.equal(readFileSync(join(r.raiz, c.out.decisao.arquivo), 'utf8'), 'Limite é 10 conforme A1.\nDetalhe.');
    assert.equal(dosTipo(r, 'sombra.consulta').length, 1, 'cache não grava consulta');
    assert.equal(c.out.consultas, undefined);
  });

  test('registrar-grava-todos-os-campos', () => {
    const r = novoRepo();
    const hash = consulta(r);
    const texto = 'texto longo da decisão';
    const reg = registrar(r, hash, { resposta: 'resumo', texto, pergunta_enviesada: true, fontes: ['f1', 'f2'], medicao: 'medi 42' });
    assert.equal(reg.rc, 0);
    const arquivo = `.harness/entregas/GM-10/sombra/${hash}.${sha256(texto).slice(0, 12)}.resposta.md`;
    const esperado = { pergunta_hash: hash, req: 'REQ-A-1', resposta: 'resumo', arquivo, pergunta_enviesada: true, fontes: ['f1', 'f2'], medicao: 'medi 42' };
    assert.deepEqual(dosTipo(r, 'decisao.sombra')[0].dados, esperado);
    assert.deepEqual(reg.out.evento, { tipo: 'decisao.sombra', ...esperado });
    assert.equal(readFileSync(join(r.raiz, arquivo), 'utf8'), texto);
    assert.equal(formaInvalida('decisao.sombra', esperado), null);
  });

  test('registrar-por-task-guarda-task-nao-req', () => {
    const r = novoRepo();
    const hash = consulta(r, 'x?', ['--task', 'T1']);
    assert.equal(registrar(r, hash, BOA).rc, 0);
    const d = dosTipo(r, 'decisao.sombra')[0].dados;
    assert.equal(d.task, 'T1');
    assert.equal(d.req, undefined);
  });

  test('registrar-sem-consulta', () => {
    const r = novoRepo();
    const a = registrar(r, sha256('nunca perguntado'), BOA);
    assert.equal(a.rc, 1);
    assert.equal(a.out.erro, 'sem_consulta');
    assert.deepEqual(dosTipo(r, 'decisao.sombra'), []);
    assert.deepEqual(arquivosSombra(r), []);
  });

  test('registrar-hash-nunca-perguntado-com-outra-consulta-aberta', () => {
    const r = novoRepo();
    const outra = consulta(r, 'pergunta real?');
    const nunca = sha256('nunca perguntado');
    assert.notEqual(outra, nunca);
    const antes = eventosDe(r).length;
    const arquivosAntes = arquivosSombra(r);
    const a = registrar(r, nunca, BOA);
    assert.equal(a.rc, 1);
    assert.equal(a.out.erro, 'sem_consulta');
    assert.deepEqual(dosTipo(r, 'decisao.sombra'), []);
    assert.equal(eventosDe(r).length, antes, 'nenhum evento novo');
    assert.deepEqual(arquivosSombra(r), arquivosAntes, 'nenhum arquivo novo');
    assert.equal(registrar(r, outra, BOA).rc, 0, 'o hash perguntado de fato segue aceito');
  });

  test('registrar-sem-fontes-nem-medicao-recusa', () => {
    const r = novoRepo();
    const hash = consulta(r);
    const { fontes, ...semFonte } = BOA;
    for (const extra of [{}, { fontes: [] }, { fontes: [''] }, { fontes: ['ok', '  '] }, { fontes: 'texto' }, { medicao: '  ' }, { medicao: 7 }, { fontes: [''], medicao: 'm' }]) {
      const a = registrar(r, hash, { ...semFonte, ...extra });
      assert.equal(a.rc, 1, JSON.stringify(extra));
      assert.equal(a.out.erro, 'sem_fonte', JSON.stringify(extra));
    }
    assert.deepEqual(dosTipo(r, 'decisao.sombra'), []);
    assert.deepEqual(arquivosSombra(r), [`${hash}.md`], 'nenhum arquivo de resposta');
  });

  test('registrar-resposta-longa-nada-gravado', () => {
    const r = novoRepo();
    const hash = consulta(r);
    const a = registrar(r, hash, { ...BOA, resposta: 'a'.repeat(1001) });
    assert.equal(a.rc, 1);
    assert.equal(a.out.erro, 'resposta_longa');
    assert.deepEqual(dosTipo(r, 'decisao.sombra'), []);
    assert.deepEqual(arquivosSombra(r), [`${hash}.md`]);
  });

  test('resposta-1000-utf16-concorda-com-forma', () => {
    const r = novoRepo();
    const hash = consulta(r);
    const casos = [
      ['a'.repeat(1000), true], ['a'.repeat(1001), false],
      ['😀'.repeat(500), true], // 1.000 unidades UTF-16
      ['😀'.repeat(1000), true], // 2.000 unidades UTF-16, 1.000 caracteres: a medida é a de formaInvalida
      ['😀'.repeat(1001), false],
    ];
    for (const [resposta, cabe] of casos) {
      const forma = formaInvalida('decisao.sombra', { pergunta_hash: hash, req: 'REQ-A-1', resposta, arquivo: 'x', pergunta_enviesada: false, fontes: ['f'] });
      assert.equal(forma === null, cabe, `forma: ${forma}`);
      const a = registrar(r, hash, { ...BOA, resposta, texto: `t${[...resposta].length}` });
      assert.equal(a.rc === 0, cabe, `${[...resposta].length} caracteres`);
      if (!cabe) assert.equal(a.out.erro, 'resposta_longa');
    }
  });

  test('registrar-fora-da-regra-exige-emenda', () => {
    const r = novoRepo();
    const hash = consulta(r);
    const fora = { resposta: 'sem fonte', texto: 'não está na spec', pergunta_enviesada: false, fora_da_regra: true };
    const recusa = (extra, msg) => {
      const a = registrar(r, hash, { ...fora, ...extra });
      assert.equal(a.rc, 1, msg);
      assert.equal(a.out.erro, 'emenda_seq_inexistente', msg);
    };
    recusa({}, 'sem emenda_seq');
    recusa({ emenda_seq: 1 }, 'proposta inexistente');
    proposta(r, 'REQ-A-2'); // seq 1, de outro REQ
    recusa({ emenda_seq: 1 }, 'proposta de outro REQ');
    proposta(r, 'REQ-A-1', 'outra-sessao'); // gravada fora da sessão `emendas`
    recusa({ emenda_seq: 1 }, 'proposta fora da sessão emendas (seq 1 da outra sessão)');
    recusa({ emenda_seq: '2' }, 'emenda_seq que não é número');
    assert.deepEqual(dosTipo(r, 'decisao.sombra'), []);
    proposta(r, 'REQ-A-1'); // seq 2 na sessão emendas
    const ok = registrar(r, hash, { ...fora, emenda_seq: 2 });
    assert.equal(ok.rc, 0, JSON.stringify(ok.out));
    const d = dosTipo(r, 'decisao.sombra')[0].dados;
    assert.equal(d.fora_da_regra, true);
    assert.equal(d.emenda_seq, 2);
    assert.equal(d.fontes, undefined);
  });

  test('registrar-fora-da-regra-aceita-proposta-ja-julgada', () => {
    const r = novoRepo();
    const hash = consulta(r);
    proposta(r, 'REQ-A-1'); // seq 1: aprovada
    proposta(r, 'REQ-A-1'); // seq 2: rejeitada
    julgar(r, 1);
    evento(r, 'loop', 'emenda.rejeitada', { proposta_seq: 2, origem: 'dono' });
    const fora = { resposta: 'sem fonte', texto: 'fora', pergunta_enviesada: false, fora_da_regra: true };
    assert.equal(registrar(r, hash, { ...fora, emenda_seq: 1 }).rc, 0, 'aprovada');
    assert.equal(registrar(r, hash, { ...fora, emenda_seq: 2, texto: 'fora2' }).rc, 0, 'rejeitada');
  });

  test('registrar-fora-da-regra-por-task-usa-reqs-da-task', () => {
    const r = novoRepo();
    const hash = consulta(r, 'x?', ['--task', 'T1']);
    const fora = { resposta: 'sem fonte', texto: 'fora', pergunta_enviesada: false, fora_da_regra: true };
    proposta(r, 'REQ-Z-1'); // req de T3, não de T1
    assert.equal(registrar(r, hash, { ...fora, emenda_seq: 1 }).out.erro, 'emenda_seq_inexistente');
    proposta(r, 'REQ-A-2'); // req de T1
    assert.equal(registrar(r, hash, { ...fora, emenda_seq: 2 }).rc, 0);
  });

  test('registrar-fora-da-regra-false-omitido', () => {
    const r = novoRepo();
    const hash = consulta(r);
    const a = registrar(r, hash, { ...BOA, fora_da_regra: false, emenda_seq: 9, extra: 'x', req: 'REQ-A-2' });
    assert.equal(a.rc, 0, JSON.stringify(a.out));
    const d = dosTipo(r, 'decisao.sombra')[0].dados;
    assert.equal(Object.hasOwn(d, 'fora_da_regra'), false);
    assert.equal(Object.hasOwn(d, 'emenda_seq'), false);
    assert.equal(Object.hasOwn(d, 'extra'), false);
  });

  test('registrar-ancora-vem-da-consulta', () => {
    const r = novoRepo();
    const hash = consulta(r);
    assert.equal(registrar(r, hash, { ...BOA, req: 'REQ-OUTRO-1', task: 'T9' }).rc, 0);
    const d = dosTipo(r, 'decisao.sombra')[0].dados;
    assert.equal(d.req, 'REQ-A-1');
    assert.equal(Object.hasOwn(d, 'task'), false);
  });

  test('registrar-substitui-inexistente', () => {
    const r = novoRepo();
    const hash = consulta(r);
    const outro = consulta(r, 'outra pergunta?');
    assert.equal(registrar(r, outro, BOA).rc, 0); // decisão de OUTRO hash: loop seq 3
    const decisaoDoOutro = dosTipo(r, 'decisao.sombra')[0];
    for (const substitui of [{ sessao: 'loop', seq: 99 }, { sessao: decisaoDoOutro.sessao, seq: 1 }, { sessao: decisaoDoOutro.sessao, seq: decisaoDoOutro.seq }, 'x', { sessao: 'loop' }]) {
      const a = registrar(r, hash, { ...BOA, substitui });
      assert.equal(a.rc, 1, JSON.stringify(substitui));
      assert.equal(a.out.erro, 'substitui_inexistente', JSON.stringify(substitui));
    }
    assert.equal(dosTipo(r, 'decisao.sombra').length, 1);
  });

  test('registrar-substitui-preserva-texto-anterior', () => {
    const r = novoRepo();
    const hash = consulta(r);
    assert.equal(registrar(r, hash, { ...BOA, resposta: 'primeira', texto: 'TEXTO UM' }).rc, 0);
    const [d1] = dosTipo(r, 'decisao.sombra');
    const e1 = eventosDe(r).find((e) => e.tipo === 'decisao.sombra');
    const b = registrar(r, hash, { ...BOA, resposta: 'segunda', texto: 'TEXTO DOIS', substitui: { sessao: e1.sessao, seq: e1.seq } });
    assert.equal(b.rc, 0, JSON.stringify(b.out));
    const [, d2] = dosTipo(r, 'decisao.sombra');
    assert.notEqual(d1.dados.arquivo, d2.dados.arquivo);
    assert.ok(d2.dados.arquivo.endsWith(`.${sha256('TEXTO DOIS').slice(0, 12)}.resposta.md`));
    assert.deepEqual(d2.dados.substitui, { sessao: e1.sessao, seq: e1.seq });
    assert.equal(readFileSync(join(r.raiz, d1.dados.arquivo), 'utf8'), 'TEXTO UM', 'o texto da 1ª decisão continua lá');
    assert.equal(readFileSync(join(r.raiz, d2.dados.arquivo), 'utf8'), 'TEXTO DOIS');
    assert.equal(perguntar(r.raiz, 'Qual o limite?').out.decisao.resposta, 'segunda');
    // o mesmo texto de novo (retentativa) é aceito: o arquivo é o mesmo e não é sobrescrito com outro conteúdo
    assert.equal(registrar(r, hash, { ...BOA, resposta: 'terceira', texto: 'TEXTO DOIS' }).rc, 0);
    assert.equal(readFileSync(join(r.raiz, d2.dados.arquivo), 'utf8'), 'TEXTO DOIS');
  });

  test('registrar-segredo-nada-escrito', () => {
    const r = novoRepo();
    const hash = consulta(r);
    const antes = arquivosSombra(r);
    const tok = segredo('gh', 'p_') + 'b'.repeat(36);
    for (const parte of [{ texto: `veja ${'-----'}BEGIN chave` }, { resposta: `x ${tok}` }, { texto: `veja ${tok}` }]) {
      const a = registrar(r, hash, { ...BOA, ...parte });
      assert.equal(a.rc, 1, JSON.stringify(parte));
      assert.equal(a.out.erro, 'segredo_na_resposta', JSON.stringify(parte));
      assert.ok(!JSON.stringify(a.out).includes(tok));
    }
    assert.deepEqual(arquivosSombra(r), antes, 'nenhum arquivo de resposta');
    assert.deepEqual(dosTipo(r, 'decisao.sombra'), []);
  });

  test('registrar-resposta-ausente-x-invalida', () => {
    const r = novoRepo();
    const hash = consulta(r);
    const a = rodar(r.raiz, ['registrar', hash, join(r.raiz, 'nao-existe.json'), '--entrega', 'GM-10']);
    assert.equal(a.out.erro, 'resposta_ausente');
    assert.equal(registrar(r, hash, '{nao json').out.erro, 'resposta_invalida');
    assert.equal(registrar(r, hash, '[1]').out.erro, 'resposta_invalida');
    assert.equal(registrar(r, hash, 'null').out.erro, 'resposta_invalida');
    const dir = join(r.raiz, 'pasta.json');
    mkdirSync(dir);
    assert.equal(rodar(r.raiz, ['registrar', hash, dir, '--entrega', 'GM-10']).out.erro, 'resposta_invalida', 'ilegível ≠ ausente');
    for (const [campo, valor] of [['resposta', ''], ['resposta', 7], ['texto', '  '], ['texto', undefined], ['pergunta_enviesada', 'sim'], ['pergunta_enviesada', undefined], ['fora_da_regra', 'true']]) {
      const x = registrar(r, hash, { ...BOA, [campo]: valor });
      assert.equal(x.rc, 1, campo);
      assert.equal(x.out.erro, 'resposta_invalida', campo);
      assert.ok(x.out.mensagem.includes(campo), `cita o campo ${campo}: ${x.out.mensagem}`);
    }
    assert.deepEqual(dosTipo(r, 'decisao.sombra'), []);
  });

  test('registrar-nao-sobrescreve-arquivo-com-outro-conteudo', () => {
    const r = novoRepo();
    const hash = consulta(r);
    const texto = 'TEXTO NOVO';
    mkdirSync(r.sombra, { recursive: true });
    const alvo = join(r.sombra, `${hash}.${sha256(texto).slice(0, 12)}.resposta.md`);
    writeFileSync(alvo, 'OUTRO CONTEÚDO, NÃO PODE SER PERDIDO');
    const a = registrar(r, hash, { ...BOA, texto });
    assert.equal(a.rc, 1);
    assert.equal(a.out.erro, 'resposta_nao_gravada');
    assert.equal(readFileSync(alvo, 'utf8'), 'OUTRO CONTEÚDO, NÃO PODE SER PERDIDO');
    assert.deepEqual(dosTipo(r, 'decisao.sombra'), [], 'sem arquivo íntegro não há decisão');
  });

  test('registrar-append-falho-deixa-arquivo-sem-decisao', { skip: process.getuid?.() === 0 }, () => {
    const r = novoRepo();
    const hash = consulta(r);
    chmodSync(r.dir, 0o555); // o diário não grava; a pasta sombra (subpasta) continua gravável
    try {
      const a = registrar(r, hash, BOA);
      assert.equal(a.rc, 1);
      assert.equal(a.out.erro, 'evento_nao_gravado');
      assert.doesNotMatch(a.out.mensagem, /canário/, 'falha de gravação não é recusa de canário');
    } finally {
      chmodSync(r.dir, 0o755);
    }
    assert.deepEqual(dosTipo(r, 'decisao.sombra'), []);
    assert.equal(arquivosSombra(r).filter((f) => f.endsWith('.resposta.md')).length, 1, 'o arquivo fica, a decisão não');
  });
});

describe('agente', () => {
  test('agente-sombra-frontmatter', () => {
    const texto = readFileSync(AGENTE, 'utf8');
    const m = /^---\n([\s\S]*?)\n---\n/u.exec(texto);
    assert.ok(m, 'frontmatter');
    const fm = Object.fromEntries(m[1].split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
    assert.equal(fm.name, 'gabarito-sombra');
    assert.equal(fm.model, 'opus');
    const ferramentas = fm.tools.split(',').map((t) => t.trim());
    assert.deepEqual(ferramentas, ['Read', 'Glob', 'Grep']);
    for (const proibida of ['Write', 'Edit', 'Bash', 'NotebookEdit']) assert.ok(!ferramentas.includes(proibida), proibida);
    assert.match(texto, /`env`/);
    assert.match(texto, /\.env/);
    assert.match(texto, /fora_da_regra/);
  });
});

/**
 * T9 (GM-14, REQ-ONB-2, oferta do modo foco): `onboarding-foco.mjs` (`ofertaFoco`, `gravarFoco`) e o CLI `onboarding.mjs foco`.
 *
 * Tudo em mkdtemp, com git real isolado do usuário (HOME, XDG_CONFIG_HOME, GIT_CONFIG_GLOBAL e GIT_CONFIG_NOSYSTEM): nenhum teste
 * lê nem escreve o `.claude/` ou o git config de quem roda. S1b(ii) REFUTADA: o foco exige tela cheia, então o "sim" grava
 * `viewMode: "focus"` E `tui: "fullscreen"`. As funções aceitam `exigeTelaCheia` só para os testes trocarem a constante.
 * Costura (P9): `cli-oferta-e-sim-pelo-despachante` atravessa onboarding.mjs → onboarding-foco.mjs → rodarReal → git real.
 *
 * MUTAÇÕES (task-9-mut.json): M-T9a (oferta grava), M-T9a2 (despacho grava sem --sim), M-T9b (grava sem check-ignore) e as do arquivo.
 */

import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { FOCO_EXIGE_TELA_CHEIA, ofertaFoco, gravarFoco, Falha } from '../scripts/onboarding-foco.mjs';
import { rodarReal } from '../scripts/onboarding.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CLI = join(AQUI, '..', 'scripts', 'onboarding.mjs');
const limpar = [];
after(() => { for (const d of limpar) rmSync(d, { recursive: true, force: true }); });

const novoDir = (prefixo = 'gm-foco-') => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefixo)));
  limpar.push(d);
  return d;
};

// git isolado do usuário: o ignore global e o config global vêm daqui, nunca de quem roda o teste.
const HOME_FALSO = novoDir('gm-foco-home-');
const ENV_GIT = { HOME: HOME_FALSO, XDG_CONFIG_HOME: join(HOME_FALSO, 'xdg'), GIT_CONFIG_GLOBAL: join(HOME_FALSO, 'gitconfig-vazio'), GIT_CONFIG_NOSYSTEM: '1' };
const guardado = {};
before(() => {
  writeFileSync(ENV_GIT.GIT_CONFIG_GLOBAL, '');
  for (const [k, v] of Object.entries(ENV_GIT)) { guardado[k] = process.env[k]; process.env[k] = v; }
});
after(() => { for (const [k, v] of Object.entries(guardado)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

const repoNovo = (nome = 'projeto') => {
  const d = join(novoDir(), nome);
  mkdirSync(d, { recursive: true });
  execFileSync('git', ['init', '-q', d], { env: process.env });
  return d;
};
const SETTINGS = '.claude/settings.local.json';
const gravarSettings = (raiz, texto) => { mkdirSync(join(raiz, '.claude'), { recursive: true }); writeFileSync(join(raiz, SETTINGS), texto); };
const lerSettings = (raiz) => JSON.parse(readFileSync(join(raiz, SETTINGS), 'utf8'));
const bytes = (raiz, rel) => readFileSync(join(raiz, rel));

/** Árvore inteira (caminho → conteúdo), sem `.git`: prova "nada foi tocado". */
function arvore(raiz, rel = '') {
  const saida = {};
  for (const e of readdirSync(join(raiz, rel), { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { saida[`${r}/`] = null; Object.assign(saida, arvore(raiz, r)); } else saida[r] = readFileSync(join(raiz, r)).toString('base64');
  }
  return saida;
}

const OFERTA_BASE = 'Quer o chat mais limpo, só com a sua pergunta, um resumo do que a IA fez e a resposta?';
const AVISO_JANELA = ' (o Claude passa a ocupar a janela inteira)';
const rodarFalso = (resposta, chamadas = []) => (cmd, args, opts) => { chamadas.push({ cmd, args, opts }); return typeof resposta === 'function' ? resposta(cmd, args, opts) : resposta; };
const rc = (n, extra = {}) => ({ rc: n, stdout: '', stderr: '', motivo: null, ...extra });

describe('oferta (só lê)', () => {
  test('constante-exige-tela-cheia (S1b ii refutada)', () => {
    assert.equal(FOCO_EXIGE_TELA_CHEIA, true);
  });

  test('oferta-copia-o-texto-da-spec-e-o-aviso-so-se-exige-tela-cheia', () => {
    const raiz = repoNovo();
    const com = ofertaFoco(raiz);
    assert.equal(com.oferecer, true);
    assert.equal(com.texto, OFERTA_BASE + AVISO_JANELA);
    assert.deepEqual(com.opcoes, ['sim', 'não, obrigado']);
    assert.equal(com.default, 'não, obrigado');
    const sem = ofertaFoco(raiz, { exigeTelaCheia: false });
    assert.equal(sem.oferecer, true);
    assert.equal(sem.texto, OFERTA_BASE);
    assert.ok(!sem.texto.includes('janela'));
    assert.deepEqual(sem.opcoes, ['sim', 'não, obrigado']);
    assert.equal(sem.default, 'não, obrigado');
  });

  test('oferta-sem-termo-tecnico-e-dentro-do-limite', () => {
    const { texto, opcoes } = ofertaFoco(repoNovo());
    assert.ok(texto.length <= 160, `texto ${texto.length}`);
    for (const o of opcoes) assert.ok(o.length <= 60);
    assert.doesNotMatch(texto, /[`]|--|\bnode\b|\.(json|mjs|md)\b|viewMode|tui|fullscreen|settings/i);
  });

  test('nao-obrigado-settings-iguais: a oferta e o CLI sem --sim não tocam em nada, com settings ausente ou existente', () => {
    const cenarios = {
      ausente: null,
      objeto: '{"permissions":{"allow":["Bash(ls)"]},"viewMode":"verbose"}\n',
      estranho: '{\r\n\t"a": 1, "b" :[1,2 ,3]\r\n}',
      corrompido: '{ // comentário\n "a": 1,\n}',
    };
    for (const [nome, texto] of Object.entries(cenarios)) {
      const raiz = repoNovo();
      writeFileSync(join(raiz, '.gitignore'), 'node_modules/');
      if (texto !== null) gravarSettings(raiz, texto);
      const antes = arvore(raiz);
      ofertaFoco(raiz);
      assert.deepEqual(arvore(raiz), antes, `ofertaFoco mexeu (${nome})`);
      const r = spawnSync(process.execPath, [CLI, 'foco', '--root', raiz], { encoding: 'utf8', env: process.env });
      assert.equal(r.stderr, '');
      assert.deepEqual(arvore(raiz), antes, `CLI sem --sim mexeu (${nome})`);
      assert.equal(existsSync(join(raiz, SETTINGS)), texto !== null, `existência do arquivo mudou (${nome})`);
    }
  });

  test('oferta-nao-roda-processo-nenhum: lê só o arquivo (nem git)', () => {
    const raiz = novoDir(); // sem git: se a oferta chamasse git, o resultado dependeria dele
    assert.equal(ofertaFoco(raiz).oferecer, true);
  });

  test('ja-em-foco-nao-oferece', () => {
    const raiz = repoNovo();
    gravarSettings(raiz, '{"viewMode":"focus"}');
    const o = ofertaFoco(raiz);
    assert.equal(o.oferecer, false);
    // troca de valor: outro viewMode volta a oferecer (o teste distingue "focus" de "tem viewMode")
    gravarSettings(raiz, '{"viewMode":"verbose"}');
    assert.equal(ofertaFoco(raiz).oferecer, true);
    gravarSettings(raiz, '{"viewMode":"Focus"}');
    assert.equal(ofertaFoco(raiz).oferecer, true, 'caixa diferente não é foco: o Claude Code compara exato');
  });

  test('oferta-settings-ausente-x-corrompido: ausente oferece; corrompido não oferece e diz por quê', () => {
    const raiz = repoNovo();
    const ausente = ofertaFoco(raiz);
    assert.equal(ausente.oferecer, true);
    assert.equal(ausente.motivo, undefined);
    gravarSettings(raiz, '{ "viewMode": "focus", }');
    const corrompido = ofertaFoco(raiz);
    assert.equal(corrompido.oferecer, false);
    assert.equal(corrompido.motivo, 'settings_corrompido');
  });
});

describe('gravar com ok (--sim)', () => {
  test('sim-so-chaves-novas: demais chaves iguais, só viewMode e tui; todos os campos produzidos lidos', () => {
    const raiz = repoNovo();
    const original = { permissions: { allow: ['Bash(ls)'], deny: [] }, env: { A: '1' }, outra: [1, { x: null }], viewMode: 'verbose' };
    gravarSettings(raiz, `${JSON.stringify(original, null, 2)}\n`);
    const r = gravarFoco(raiz, { rodar: rodarReal });
    assert.equal(r.ok, true);
    assert.deepEqual(r.chaves, ['viewMode', 'tui']);
    assert.equal(r.gitignore, 'acrescentado');
    assert.equal(typeof r.frase, 'string');
    assert.ok(r.frase.length > 0);
    assert.equal(typeof r.comoVoltar, 'string');
    assert.ok(r.comoVoltar.length > 0);
    const depois = lerSettings(raiz);
    assert.equal(depois.viewMode, 'focus');
    assert.equal(depois.tui, 'fullscreen');
    const { viewMode: _v, tui: _t, ...resto } = depois;
    const { viewMode: _vo, ...restoOriginal } = original;
    assert.deepEqual(resto, restoOriginal);
    assert.deepEqual(Object.keys(depois), ['permissions', 'env', 'outra', 'viewMode', 'tui'], 'ordem das chaves preservada, a nova vai ao fim');
  });

  test('sim-grava-tui-se-exige: troca a constante; sem tela cheia só viewMode', () => {
    const exige = repoNovo();
    const a = gravarFoco(exige, { rodar: rodarReal, exigeTelaCheia: true });
    assert.deepEqual(a.chaves, ['viewMode', 'tui']);
    assert.deepEqual(lerSettings(exige), { viewMode: 'focus', tui: 'fullscreen' });
    assert.match(a.frase, /janela inteira/);
    const basta = repoNovo();
    const b = gravarFoco(basta, { rodar: rodarReal, exigeTelaCheia: false });
    assert.deepEqual(b.chaves, ['viewMode']);
    assert.deepEqual(lerSettings(basta), { viewMode: 'focus' });
    assert.doesNotMatch(b.frase, /janela inteira/);
    // padrão = a constante medida
    const padrao = repoNovo();
    assert.deepEqual(gravarFoco(padrao, { rodar: rodarReal }).chaves, FOCO_EXIGE_TELA_CHEIA ? ['viewMode', 'tui'] : ['viewMode']);
  });

  test('viewMode-diferente-troca-so-essa-chave: tui já correto não entra em chaves', () => {
    const raiz = repoNovo();
    gravarSettings(raiz, '{"viewMode":"verbose","tui":"fullscreen","k":1}');
    const r = gravarFoco(raiz, { rodar: rodarReal });
    assert.deepEqual(r.chaves, ['viewMode']);
    assert.deepEqual(lerSettings(raiz), { viewMode: 'focus', tui: 'fullscreen', k: 1 });
    assert.match(r.comoVoltar, /verbose/, 'diz o valor anterior de viewMode');
  });

  test('como-voltar-diz-o-que-estava-antes: chave ausente ⇒ apagar; chave com valor ⇒ voltar ao valor', () => {
    const a = repoNovo();
    const ra = gravarFoco(a, { rodar: rodarReal });
    assert.match(ra.comoVoltar, /\.claude\/settings\.local\.json/);
    assert.match(ra.comoVoltar, /viewMode/);
    assert.match(ra.comoVoltar, /tui/);
    assert.match(ra.comoVoltar, /apag/i);
    const b = repoNovo();
    gravarSettings(b, '{"tui":"default"}');
    const rb = gravarFoco(b, { rodar: rodarReal });
    assert.match(rb.comoVoltar, /default/);
    assert.match(rb.comoVoltar, /apag/i, 'viewMode estava ausente');
  });

  test('ja-em-foco-e-tela-cheia: idempotente, arquivo byte a byte igual, chaves vazias', () => {
    const raiz = repoNovo();
    writeFileSync(join(raiz, '.gitignore'), '.claude/settings.local.json\n');
    gravarSettings(raiz, '{"tui":"fullscreen",   "viewMode":"focus"}');
    const antes = bytes(raiz, SETTINGS);
    const r = gravarFoco(raiz, { rodar: rodarReal });
    assert.equal(r.ok, true);
    assert.deepEqual(r.chaves, []);
    assert.deepEqual(bytes(raiz, SETTINGS), antes);
  });

  test('indentacao-preservada: arquivo com tab continua com tab; sem indentação, 2 espaços', () => {
    const t = repoNovo();
    gravarSettings(t, '{\n\t"a": 1\n}\n');
    gravarFoco(t, { rodar: rodarReal });
    assert.match(readFileSync(join(t, SETTINGS), 'utf8'), /\n\t"viewMode": "focus"/);
    const n = repoNovo();
    gravarFoco(n, { rodar: rodarReal });
    assert.equal(readFileSync(join(n, SETTINGS), 'utf8'), '{\n  "viewMode": "focus",\n  "tui": "fullscreen"\n}\n');
  });

  test('sem-rodar-recusa: gravar exige o executor injetado e nada é escrito', () => {
    const raiz = repoNovo();
    assert.throws(() => gravarFoco(raiz), (e) => e instanceof Falha && e.erro === 'sem_executor');
    assert.deepEqual(arvore(raiz), {});
  });
});

describe('check-ignore antes de gravar', () => {
  test('ignore-global-ausente-acrescenta-linha: sem .gitignore, cria com a linha; com .gitignore sem \\n final, a linha vai à parte', () => {
    const a = repoNovo();
    const ra = gravarFoco(a, { rodar: rodarReal });
    assert.equal(ra.gitignore, 'acrescentado');
    assert.equal(readFileSync(join(a, '.gitignore'), 'utf8'), '.claude/settings.local.json\n');
    // o git agora confirma o ignore (distingue "acrescentou a linha certa" de "acrescentou qualquer linha")
    assert.equal(rodarReal('git', ['-C', a, 'check-ignore', '-q', SETTINGS]).rc, 0);
    const b = repoNovo();
    writeFileSync(join(b, '.gitignore'), 'node_modules/\ndist');
    const rb = gravarFoco(b, { rodar: rodarReal });
    assert.equal(rb.gitignore, 'acrescentado');
    assert.equal(readFileSync(join(b, '.gitignore'), 'utf8'), 'node_modules/\ndist\n.claude/settings.local.json\n');
    const c = repoNovo();
    writeFileSync(join(c, '.gitignore'), 'a\r\nb\r\n');
    gravarFoco(c, { rodar: rodarReal });
    assert.equal(readFileSync(join(c, '.gitignore'), 'utf8'), 'a\r\nb\r\n.claude/settings.local.json\r\n', 'respeita o fim de linha do arquivo');
  });

  test('ja-ignorado-nao-mexe: por .gitignore do repo, por .git/info/exclude e por ignore global; .gitignore byte a byte igual', () => {
    const a = repoNovo();
    writeFileSync(join(a, '.gitignore'), '# meu\n.claude/*.local.json');
    const antes = bytes(a, '.gitignore');
    const ra = gravarFoco(a, { rodar: rodarReal });
    assert.equal(ra.gitignore, 'ja_ignorado');
    assert.deepEqual(bytes(a, '.gitignore'), antes);
    assert.equal(lerSettings(a).viewMode, 'focus', 'ignorado não impede de gravar');
    const b = repoNovo();
    writeFileSync(join(b, '.git', 'info', 'exclude'), '.claude/\n');
    assert.equal(gravarFoco(b, { rodar: rodarReal }).gitignore, 'ja_ignorado');
    assert.equal(existsSync(join(b, '.gitignore')), false);
    // ignore global do usuário (core.excludesFile)
    const global = join(HOME_FALSO, 'ignore-global');
    writeFileSync(global, 'settings.local.json\n');
    const gc = join(HOME_FALSO, 'gitconfig-com-ignore');
    writeFileSync(gc, `[core]\n\texcludesFile = ${global}\n`);
    const anterior = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = gc;
    try {
      const c = repoNovo();
      assert.equal(gravarFoco(c, { rodar: rodarReal }).gitignore, 'ja_ignorado');
      assert.equal(existsSync(join(c, '.gitignore')), false, 'ignore global cobre: nada a acrescentar');
    } finally { process.env.GIT_CONFIG_GLOBAL = anterior; }
  });

  test('chama-check-ignore-quieto-no-caminho-certo-antes-de-escrever', () => {
    const raiz = repoNovo();
    const chamadas = [];
    let escritoQuandoChamou = null;
    const rodar = rodarFalso((cmd, args) => { escritoQuandoChamou = { settings: existsSync(join(raiz, SETTINGS)), gitignore: existsSync(join(raiz, '.gitignore')) }; return rc(1); }, chamadas);
    gravarFoco(raiz, { rodar });
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].cmd, 'git');
    assert.deepEqual(chamadas[0].args.slice(chamadas[0].args.indexOf('check-ignore')), ['check-ignore', '-q', '--', SETTINGS]);
    assert.ok(chamadas[0].args.includes(raiz), 'git roda NA raiz informada');
    assert.ok(Number.isInteger(chamadas[0].opts.timeoutMs) && chamadas[0].opts.timeoutMs > 0, 'com timeout');
    assert.deepEqual(escritoQuandoChamou, { settings: false, gitignore: false }, 'nada gravado antes do check-ignore');
  });

  test('check-ignore-rc1-acrescenta x rc0-nao-mexe x rc128-recusa x outros-recusam (todos sem gravar settings quando recusa)', () => {
    const caso = (resposta) => {
      const raiz = repoNovo();
      let r; let erro = null;
      try { r = gravarFoco(raiz, { rodar: rodarFalso(resposta) }); } catch (e) { erro = e; }
      return { raiz, r, erro };
    };
    const rc1 = caso(rc(1));
    assert.equal(rc1.r.gitignore, 'acrescentado');
    assert.equal(readFileSync(join(rc1.raiz, '.gitignore'), 'utf8'), '.claude/settings.local.json\n');
    assert.equal(lerSettings(rc1.raiz).viewMode, 'focus');
    const rc0 = caso(rc(0));
    assert.equal(rc0.r.gitignore, 'ja_ignorado');
    assert.equal(existsSync(join(rc0.raiz, '.gitignore')), false);
    for (const [nome, resposta] of [['128', rc(128)], ['2', rc(2)], ['ausente', rc(null, { motivo: 'ausente' })], ['timeout', rc(null, { motivo: 'timeout' })], ['erro', rc(null, { motivo: 'erro EACCES' })]]) {
      const { raiz, erro } = caso(resposta);
      assert.ok(erro instanceof Falha, `rc ${nome} deveria recusar`);
      assert.equal(erro.erro, 'check_ignore_falhou', nome);
      assert.deepEqual(arvore(raiz), {}, `rc ${nome}: nada gravado`);
    }
  });

  test('fora-de-repo-git-real-rc128-recusa-sem-gravar', () => {
    const fora = novoDir('gm-foco-fora-');
    assert.throws(() => gravarFoco(fora, { rodar: rodarReal }), (e) => e instanceof Falha && e.erro === 'check_ignore_falhou');
    assert.deepEqual(arvore(fora), {});
    const inexistente = join(fora, 'nao-existe');
    assert.throws(() => gravarFoco(inexistente, { rodar: rodarReal }), (e) => e instanceof Falha && e.erro === 'check_ignore_falhou');
    assert.equal(existsSync(inexistente), false);
  });
});

describe('settings ausente x corrompido', () => {
  test('ausente-cria-pasta-e-arquivo; corrompido-recusa-sem-gravar-nada-nem-gitignore', () => {
    const ausente = repoNovo();
    const r = gravarFoco(ausente, { rodar: rodarReal });
    assert.equal(r.ok, true);
    assert.ok(statSync(join(ausente, '.claude')).isDirectory());
    assert.deepEqual(lerSettings(ausente), { viewMode: 'focus', tui: 'fullscreen' });
    const corrompidos = {
      comentario: '{ // meu ajuste\n "a": 1 }',
      'virgula-final': '{ "a": 1, }',
      'chave-sem-aspas': '{ a: 1 }',
      array: '[1]',
      nulo: 'null',
      texto: '"focus"',
      numero: '7',
      truncado: '{ "a": 1',
    };
    for (const [nome, conteudo] of Object.entries(corrompidos)) {
      const raiz = repoNovo();
      writeFileSync(join(raiz, '.gitignore'), 'x\n');
      gravarSettings(raiz, conteudo);
      const antes = arvore(raiz);
      assert.throws(() => gravarFoco(raiz, { rodar: rodarReal }), (e) => e instanceof Falha && e.erro === 'settings_corrompido', nome);
      assert.deepEqual(arvore(raiz), antes, `${nome}: nada mudou, nem o .gitignore`);
    }
  });

  test('settings-e-pasta-ou-ilegivel-e-corrompido-tambem', () => {
    const raiz = repoNovo();
    mkdirSync(join(raiz, SETTINGS), { recursive: true });
    assert.throws(() => gravarFoco(raiz, { rodar: rodarReal }), (e) => e instanceof Falha && e.erro === 'settings_corrompido');
    assert.equal(existsSync(join(raiz, '.gitignore')), false);
  });

  test('vazio-ou-so-espaco: nada a perder, grava como arquivo novo', () => {
    for (const conteudo of ['', '  \n']) {
      const raiz = repoNovo();
      gravarSettings(raiz, conteudo);
      gravarFoco(raiz, { rodar: rodarReal });
      assert.deepEqual(lerSettings(raiz), { viewMode: 'focus', tui: 'fullscreen' });
    }
  });

  test('gitignore-ilegivel-recusa-antes-de-gravar-settings', () => {
    const raiz = repoNovo();
    mkdirSync(join(raiz, '.gitignore')); // diretório no lugar do arquivo; o git não o vê como ignore
    gravarSettings(raiz, '{"a":1}');
    const antes = arvore(raiz);
    assert.throws(() => gravarFoco(raiz, { rodar: rodarFalso(rc(1)) }), (e) => e instanceof Falha && e.erro === 'gitignore_ilegivel');
    assert.deepEqual(arvore(raiz), antes);
  });

  test('prototype: chave __proto__ no arquivo não vira viewMode nem é perdida', () => {
    const raiz = repoNovo();
    gravarSettings(raiz, '{"__proto__":{"viewMode":"verbose"},"a":1}');
    const r = gravarFoco(raiz, { rodar: rodarReal });
    assert.deepEqual(r.chaves, ['viewMode', 'tui']);
    assert.match(readFileSync(join(raiz, SETTINGS), 'utf8'), /"__proto__"/);
    assert.equal(JSON.parse(readFileSync(join(raiz, SETTINGS), 'utf8')).viewMode, 'focus');
  });
});

describe('vizinhos do caso', () => {
  test('caminho-com-espaco-e-acento: raiz, gitignore e settings', () => {
    const raiz = repoNovo('pasta com espaço é acento');
    const r = gravarFoco(raiz, { rodar: rodarReal });
    assert.equal(r.gitignore, 'acrescentado');
    assert.equal(lerSettings(raiz).viewMode, 'focus');
    assert.equal(rodarReal('git', ['-C', raiz, 'check-ignore', '-q', SETTINGS]).rc, 0);
  });

  test('raiz-relativa-e-absoluta-dao-o-mesmo', () => {
    const raiz = repoNovo();
    const cwd = process.cwd();
    try {
      process.chdir(dirname(raiz));
      const rel = gravarFoco(raiz.slice(dirname(raiz).length + 1), { rodar: rodarReal });
      assert.equal(rel.gitignore, 'acrescentado');
    } finally { process.chdir(cwd); }
    assert.deepEqual(lerSettings(raiz), { viewMode: 'focus', tui: 'fullscreen' });
  });

  test('worktree: .git é arquivo, não pasta', () => {
    const principal = repoNovo('principal');
    execFileSync('git', ['-C', principal, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'i'], { env: process.env });
    const wt = join(novoDir(), 'wt');
    execFileSync('git', ['-C', principal, 'worktree', 'add', '-q', '-b', 'b', wt], { env: process.env });
    const r = gravarFoco(wt, { rodar: rodarReal });
    assert.equal(r.gitignore, 'acrescentado');
    assert.equal(lerSettings(wt).viewMode, 'focus');
    assert.equal(existsSync(join(principal, SETTINGS)), false, 'a principal não foi tocada');
  });

  test('nao-sobra-temporario: após gravar só existem settings e gitignore', () => {
    const raiz = repoNovo();
    gravarFoco(raiz, { rodar: rodarReal });
    assert.deepEqual(Object.keys(arvore(raiz)).sort(), ['.claude/', '.claude/settings.local.json', '.gitignore']);
  });
});

describe('CLI (costura pelo despachante real)', () => {
  const cli = (args, extra = {}) => {
    const r = spawnSync(process.execPath, [CLI, 'foco', ...args], { encoding: 'utf8', env: process.env, ...extra });
    return { rc: r.status, saida: r.stdout.trim() === '' ? null : JSON.parse(r.stdout.trim().split('\n').pop()), stderr: r.stderr };
  };

  test('cli-oferta-e-sim-pelo-despachante', () => {
    const raiz = repoNovo();
    const oferta = cli(['--root', raiz]);
    assert.equal(oferta.rc, 0);
    assert.equal(oferta.saida.ok, true);
    assert.equal(oferta.saida.oferecer, true);
    assert.equal(oferta.saida.texto, OFERTA_BASE + AVISO_JANELA);
    assert.deepEqual(oferta.saida.opcoes, ['sim', 'não, obrigado']);
    assert.equal(oferta.saida.default, 'não, obrigado');
    assert.equal(existsSync(join(raiz, '.claude')), false, 'oferta não grava');
    const sim = cli(['--root', raiz, '--sim']);
    assert.equal(sim.rc, 0);
    assert.equal(sim.saida.ok, true);
    assert.deepEqual(sim.saida.chaves, ['viewMode', 'tui']);
    assert.equal(sim.saida.gitignore, 'acrescentado');
    assert.equal(typeof sim.saida.frase, 'string');
    assert.equal(typeof sim.saida.comoVoltar, 'string');
    assert.deepEqual(lerSettings(raiz), { viewMode: 'focus', tui: 'fullscreen' });
    // agora já está em foco: a oferta some
    assert.equal(cli(['--root', raiz]).saida.oferecer, false);
  });

  test('cli-corrompido-recusa-com-codigo-e-rc1', () => {
    const raiz = repoNovo();
    gravarSettings(raiz, '{ nao json');
    const antes = arvore(raiz);
    const r = cli(['--root', raiz, '--sim']);
    assert.equal(r.rc, 1);
    assert.equal(r.saida.ok, false);
    assert.equal(r.saida.erro, 'settings_corrompido');
    assert.deepEqual(arvore(raiz), antes);
  });

  test('cli-fora-de-repo-recusa', () => {
    const fora = novoDir('gm-foco-cli-fora-');
    const r = cli(['--root', fora, '--sim']);
    assert.equal(r.rc, 1);
    assert.equal(r.saida.erro, 'check_ignore_falhou');
    assert.deepEqual(arvore(fora), {});
  });
});

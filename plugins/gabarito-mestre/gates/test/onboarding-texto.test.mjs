/**
 * T7 (GM-14, REQ-ONB-2, texto): o onboarding para quem nunca programou. Só o texto muda; ids, valores, defaults, ordem e
 * teto de 5 ficam idênticos à 2.0.0 (exceto a pergunta de autonomia, que na 2.1 tem 3 respostas: GM-15 T14) (golden gerado ANTES da mudança, sem os campos de texto).
 *
 * Fixtures: `completa` e `monorepo` (repositório real em mkdtemp, remoto bare) e a 1.1.x (config antiga, sem entrega nem perfil).
 * Costura (P9): o CLI `detectar` atravessa `rodarReal` → `claude` falso (PATH) → repositório real → detectar → perguntas → previaSimples.
 * Regenerar o golden: `GERAR_GOLDEN=1 node --test test/onboarding-texto.test.mjs` (só com o texto ainda da 2.0.0).
 *
 * MUTAÇÕES (task-7-mut.json, sobre scripts/onboarding.mjs e lib/glossario.mjs): M-T7a, M-T7b e as do arquivo.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, realpathSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { coletarFatos, detectar, perguntas, previa, rodarReal, MAX_PERGUNTAS } from '../scripts/onboarding.mjs';
import { GLOSSARIO, PROIBIDOS, explicarPrimeira, previaSimples, acharProibidos } from '../lib/glossario.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CLI = join(AQUI, '..', 'scripts', 'onboarding.mjs');
const FIX = join(AQUI, 'fixtures', 'onboarding');
const GOLDEN = join(FIX, 'golden-perguntas-2.0.0.json');
const HOJE = '2025-06-30';
const FUSO = 'America/Sao_Paulo';
const CLICKUP = 'claude.ai ClickUp: https://mcp.clickup.com/mcp - ✔ Connected\n';
const SEM_MCP = 'No MCP servers configured.\n';
const CFG_11 = JSON.stringify({ fluxo: { ferramenta: 'arquivos', resolvidoEm: '2025-01-01' }, orquestracao: { modelo: { alias: 'opus', politica: 'mais-potente', validadeDias: 90, resolvidoEm: '2025-01-01' } } });
const limpar = [];
after(() => { for (const d of limpar) rmSync(d, { recursive: true, force: true }); });
const novoDir = (prefixo = 'gm-t7-') => { const d = realpathSync(mkdtempSync(join(tmpdir(), prefixo))); limpar.push(d); return d; };
const quando = (dia) => ({ GIT_AUTHOR_DATE: `${dia}T12:00:00Z`, GIT_COMMITTER_DATE: `${dia}T12:00:00Z` });
const G = (dir, args, env = {}) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
  cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', ...env }, stdio: ['ignore', 'pipe', 'pipe'],
});

/** Versiona `d` (commit inicial datado fora da janela); com `remoto`, cria um bare e deixa `origin/HEAD` ⇒ `trunk`. */
function versionar(d, trunk, { remoto = true } = {}) {
  G(d, ['init', '-q', '-b', trunk]);
  G(d, ['add', '-A']);
  G(d, ['commit', '-q', '--allow-empty', '-m', 'init'], quando('2025-01-01'));
  if (remoto) {
    const bare = novoDir('gm-t7-bare-');
    G(bare, ['init', '-q', '--bare', '-b', trunk]);
    G(d, ['remote', 'add', 'origin', bare]);
    G(d, ['push', '-q', 'origin', trunk]);
    G(d, ['remote', 'set-head', 'origin', trunk]);
  }
  return d;
}
function deFixture(nome, trunk) {
  const d = novoDir();
  cpSync(join(FIX, nome), d, { recursive: true });
  return versionar(d, trunk);
}
function comArquivos(arquivos, trunk, opcoes) {
  const d = novoDir();
  for (const [c, t] of Object.entries(arquivos)) { mkdirSync(dirname(join(d, c)), { recursive: true }); writeFileSync(join(d, c), t); }
  return versionar(d, trunk, opcoes);
}

const rodarCom = (claude) => (cmd, args, opts) => (cmd === 'claude' ? { rc: 0, stdout: claude, stderr: '', motivo: null } : rodarReal(cmd, args, opts));
const fatosDe = (raiz, claude) => coletarFatos(raiz, { rodar: rodarCom(claude), hoje: HOJE });

/** As 3 fixtures do plano: completa (tudo detectado), monorepo (condicionais) e a 1.1.x (config antiga). */
const CASOS = {
  completa: () => ({ raiz: deFixture('completa', 'trunk'), claude: CLICKUP }),
  monorepo: () => ({ raiz: deFixture('monorepo', 'main'), claude: SEM_MCP }),
  '1.1.x': () => ({ raiz: comArquivos({ 'package.json': '{"name":"a"}', 'harness.config.json': CFG_11 }, 'main', { remoto: false }), claude: SEM_MCP }),
};
/** Itens montados à mão: os 5 abertos de uma vez (o teto de 5 perguntas corta o resto). */
const ITENS_ABERTOS = [
  { item: 'tipo_repo', estado: 'ambiguo', valor: 'app', fonte: 'x', candidatos: ['app', 'repo-sem-app'] },
  { item: 'ambientes', estado: 'ambiguo', valor: 'prod', fonte: 'x', candidatos: ['prod', 'staging'] },
  { item: 'planejamento', estado: 'ambiguo', valor: 'linear', fonte: 'x', candidatos: ['linear', 'clickup'] },
  { item: 'versionamento', estado: 'ambiguo', valor: 'main', fonte: 'x', candidatos: ['main', 'develop'] },
  { item: 'orquestracao', estado: 'nao_detectado', valor: null, fonte: 'x', candidatos: [] },
];

const semTexto = (ps) => ps.map((p) => ({ id: p.id, default: p.default, valores: p.opcoes.map((o) => o.valor) }));
function montarCasos() {
  const saida = {};
  for (const [nome, monta] of Object.entries(CASOS)) {
    const { raiz, claude } = monta();
    const fatos = fatosDe(raiz, claude);
    saida[nome] = semTexto(perguntas(detectar(fatos), fatos.configExistente));
  }
  saida['todos-abertos-teto'] = semTexto(perguntas(ITENS_ABERTOS, null));
  return saida;
}

describe('golden', () => {
  test('golden-perguntas-sem-texto-igual-2-0-0', () => {
    const agora = montarCasos();
    if (process.env.GERAR_GOLDEN === '1') {
      writeFileSync(GOLDEN, `${JSON.stringify(agora, null, 2)}\n`);
      return;
    }
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    // ids, valores (na ordem, default primeiro), defaults e o teto de 5: tudo da 2.0.0, nada de texto
    assert.deepEqual(agora, golden);
    assert.equal(golden['todos-abertos-teto'].length, MAX_PERGUNTAS);
    assert.deepEqual(golden['todos-abertos-teto'].map((p) => p.id), ['politica', 'autonomia', 'perfil', 'tipo_repo', 'ambientes']);
    assert.deepEqual(golden.completa.map((p) => p.id), ['politica', 'autonomia', 'perfil']);
  });
});

// ────────────────────────────────────────────────────────────── texto

const tam = (t) => [...t].length;
/** Todo texto que o dono lê numa pergunta, na ordem de exibição: a pergunta e depois cada opção. */
const textosDe = (ps) => ps.flatMap((p) => [p.texto, ...p.opcoes.map((o) => o.rotulo)]);
const porValor = (p, v) => p.opcoes.find((o) => o.valor === v).rotulo;
/** Os 4 conjuntos que o dono vê: as 3 fixtures e os 5 itens abertos de uma vez. */
function conjuntos() {
  const lista = Object.entries(CASOS).map(([nome, monta]) => {
    const { raiz, claude } = monta();
    const fatos = fatosDe(raiz, claude);
    const itens = detectar(fatos);
    return { nome, itens, ps: perguntas(itens, fatos.configExistente) };
  });
  lista.push({ nome: 'todos-abertos', itens: ITENS_ABERTOS, ps: perguntas(ITENS_ABERTOS, null) });
  return lista;
}
const CONJUNTOS = conjuntos();

describe('perguntas pela consequência', () => {
  test('as 3 fixas dizem o que acontece, na ordem e com os valores da 2.0.0', () => {
    const [a, b, c] = CONJUNTOS[0].ps;
    assert.deepEqual([a.id, b.id, c.id], ['politica', 'autonomia', 'perfil']);
    // (a) o que a IA faz com a entrega pronta: pedido de revisão / publica no horário / publica quando os testes passam
    assert.match(a.texto, /entrega pronta/);
    assert.match(porValor(a, 'sob_demanda'), /pedido de revisão/);
    assert.match(porValor(a, 'janela'), /horário/);
    assert.match(porValor(a, 'continua'), /testes/);
    assert.doesNotMatch(porValor(a, 'sob_demanda'), /horário|testes/);
    assert.doesNotMatch(porValor(a, 'janela'), /pedido de revisão|testes/);
    assert.doesNotMatch(porValor(a, 'continua'), /horário|pedido de revisão/);
    // (b) publicar sozinha ou esperar "pode"
    assert.match(b.texto, /sozinha/);
    assert.match(porValor(b, 'publica'), /sozinha/);
    assert.match(porValor(b, 'espera'), /pode/);
    assert.doesNotMatch(porValor(b, 'publica'), /pode"/);
    // (c) gastar menos / equilibrar / errar menos
    assert.match(porValor(c, 'economia'), /Gastar menos/);
    assert.match(porValor(c, 'padrao'), /Equilibrar/);
    assert.match(porValor(c, 'qualidade'), /Errar menos/);
    assert.doesNotMatch(porValor(c, 'economia'), /Errar menos|Equilibrar/);
    assert.doesNotMatch(porValor(c, 'qualidade'), /Gastar menos|Equilibrar/);
  });

  test('o "não" da autonomia diz o que acontece quando a política já publicaria sozinha', () => {
    const it = CONJUNTOS[0].itens;
    const nao = (entrega) => porValor(perguntas(it, { entrega })[1], 'espera');
    assert.match(nao({ politica: 'continua' }), /pedido de revisão/);
    assert.match(nao({ politica: 'janela' }), /pedido de revisão/);
    assert.equal(nao({ politica: 'continua' }), nao({ politica: 'janela' }));
    assert.notEqual(nao({ politica: 'sob_demanda' }), nao({ politica: 'continua' }));
    assert.doesNotMatch(nao({ politica: 'sob_demanda' }), /pedido de revisão/);
  });

  test('cada pergunta de item fala do projeto, sem a fonte nem o estado técnico', () => {
    const ps = CONJUNTOS.find((c) => c.nome === 'todos-abertos').ps;
    const q = (id) => ps.find((p) => p.id === id);
    assert.match(q('tipo_repo').texto, /aplicativo/);
    assert.match(porValor(q('tipo_repo'), 'app'), /aplicativo/);
    assert.doesNotMatch(porValor(q('tipo_repo'), 'repo-sem-app'), /aplicativo ou site\b/);
    assert.match(q('ambientes').texto, /pessoas usam/);
    assert.equal(porValor(q('ambientes'), 'staging'), 'staging', 'o nome do ambiente é do projeto: vai como está');
    for (const p of ps) assert.doesNotMatch(p.texto, /fonte|ambiguo|nao_detectado|Qual usar/, p.id);
  });

  test('pergunta-ate-160-opcao-ate-60', () => {
    let n = 0;
    for (const { nome, ps } of CONJUNTOS) {
      for (const p of ps) {
        assert.ok(tam(p.texto) <= 160, `${nome}/${p.id}: pergunta com ${tam(p.texto)}: ${p.texto}`);
        for (const o of p.opcoes) { assert.ok(tam(o.rotulo) <= 60, `${nome}/${p.id}: opção com ${tam(o.rotulo)}: ${o.rotulo}`); n += 1; }
      }
    }
    assert.ok(n >= 20, `só ${n} opções medidas`);
  });

  test('o teto de 5 perguntas continua valendo com o texto novo', () => {
    for (const { nome, ps } of CONJUNTOS) assert.ok(ps.length <= MAX_PERGUNTAS, nome);
    assert.equal(CONJUNTOS.find((c) => c.nome === 'todos-abertos').ps.length, MAX_PERGUNTAS);
  });
});

describe('glossário e lista proibida', () => {
  test('glossário fechado: termo e explicação ≤ 120, sem repetir termo nem usar palavra proibida', () => {
    assert.ok(GLOSSARIO.length >= 3);
    const termos = GLOSSARIO.map((g) => g.termo.toLowerCase());
    assert.equal(new Set(termos).size, termos.length);
    for (const g of GLOSSARIO) {
      assert.ok(g.termo.length > 0 && g.explicacao.length > 0 && tam(g.explicacao) <= 120, g.termo);
      assert.deepEqual(acharProibidos(`${g.termo} ${g.explicacao}`), [], g.termo);
    }
  });

  test('lista proibida traz os termos do spec e nome de método de ensino', () => {
    for (const t of ['branch', 'merge', 'deploy', 'PR', 'CI', 'commit', 'hook', 'spec', 'token', '.json', '--', 'leigo']) assert.ok(PROIBIDOS.includes(t), t);
    assert.ok(PROIBIDOS.some((t) => t instanceof RegExp && t.test('R20')), '/R\\d+/');
    assert.ok(PROIBIDOS.length > 14, 'e os nomes de método de ensino');
  });

  test('acharProibidos pega a palavra inteira (com plural) e não o pedaço de outra palavra', () => {
    assert.deepEqual(acharProibidos('abra o PR e o merge'), ['PR', 'merge']);
    assert.deepEqual(acharProibidos('os commits e o Deploy'), ['commit', 'deploy']);
    assert.deepEqual(acharProibidos('regra R20 no harness.json e --flag'), ['R\\d+', '.json', '--']);
    assert.deepEqual(acharProibidos('o produto decide a especificação, uma decisão do comitê'), []);
    assert.deepEqual(acharProibidos('explicar como a um leigo'), ['leigo']);
  });

  test('fixtures-sem-proibido (3 fixtures: previaSimples e perguntas)', () => {
    for (const { nome, itens, ps } of CONJUNTOS) {
      assert.deepEqual(acharProibidos(previaSimples(itens, ps)), [], `${nome}: previaSimples`);
      for (const t of textosDe(ps)) assert.deepEqual(acharProibidos(t), [], `${nome}: ${t}`);
    }
  });

  test('sem-metodo-nem-leigo: nenhum nome de método de ensino em nada que o dono lê', () => {
    const metodos = PROIBIDOS.filter((t) => typeof t === 'string' && !['branch', 'merge', 'deploy', 'PR', 'CI', 'commit', 'hook', 'spec', 'token', '.json', '--'].includes(t));
    assert.ok(metodos.includes('leigo') && metodos.length >= 4, metodos.join(','));
    for (const { nome, itens, ps } of CONJUNTOS) {
      const tudo = [previaSimples(itens, ps), ...textosDe(ps), ...GLOSSARIO.map((g) => `${g.termo} ${g.explicacao}`)].join('\n').toLowerCase();
      for (const m of metodos) assert.equal(tudo.includes(m.toLowerCase()), false, `${nome}: "${m}"`);
    }
  });

  test('termo-explicado-na-primeira (função): 1ª ocorrência ganha a explicação, as outras não, e o conjunto visto cresce', () => {
    const vistos = new Set();
    const g = GLOSSARIO[0];
    const um = explicarPrimeira(`Abra o ${g.termo} agora.`, vistos);
    assert.equal(um, `Abra o ${g.termo} (${g.explicacao}) agora.`);
    assert.ok(vistos.has(g.termo.toLowerCase()));
    assert.equal(explicarPrimeira(`De novo: ${g.termo}.`, vistos), `De novo: ${g.termo}.`);
    // duas ocorrências no mesmo texto: só a 1ª
    assert.equal(explicarPrimeira(`${g.termo} e ${g.termo}`, new Set()), `${g.termo} (${g.explicacao}) e ${g.termo}`);
    // caixa diferente e pedaço de outra palavra
    assert.equal(explicarPrimeira(g.termo.toUpperCase(), new Set()), `${g.termo.toUpperCase()} (${g.explicacao})`);
    assert.equal(explicarPrimeira(`super${g.termo}ico`, new Set()), `super${g.termo}ico`);
    assert.equal(explicarPrimeira('sem termo nenhum', new Set()), 'sem termo nenhum');
  });

  test('termo-explicado-na-primeira (nas perguntas): por conjunto, a 1ª ocorrência na ordem de exibição leva a explicação', () => {
    let achados = 0;
    for (const { nome, ps } of CONJUNTOS) {
      const tudo = textosDe(ps).join('\n');
      for (const g of GLOSSARIO) {
        const re = new RegExp(g.termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const casos = [...tudo.matchAll(re)];
        if (casos.length === 0) continue;
        achados += 1;
        const primeira = casos[0];
        assert.equal(tudo.slice(primeira.index + primeira[0].length, primeira.index + primeira[0].length + g.explicacao.length + 3), ` (${g.explicacao})`, `${nome}: ${g.termo}`);
        assert.equal(tudo.split(`(${g.explicacao})`).length - 1, 1, `${nome}: ${g.termo} explicado mais de uma vez`);
      }
    }
    assert.ok(achados >= 3 * 4, `só ${achados} termos achados`);
  });
});

describe('prévia simples', () => {
  const it = (item, estado, valor, candidatos = []) => ({ item, estado, valor, fonte: 'x', candidatos });
  const base = () => [
    it('tipo_repo', 'detectado', 'app'),
    it('ambientes', 'detectado', { producao: 'producao-eu', outros: ['staging'] }),
    it('planejamento', 'detectado', { ferramenta: 'clickup', mcp: null }),
    it('versionamento', 'detectado', 'trunk'),
    it('orquestracao', 'detectado', { simultaneos: 7, teto: 9 }),
  ];
  const tres = [{ id: 'politica' }, { id: 'autonomia' }, { id: 'perfil' }];
  const cinco = [...tres, { id: 'tipo_repo' }, { id: 'ambientes' }];
  const linhas = (itens, ps = tres) => previaSimples(itens, ps).split('\n');

  test('abre com a oficina onde o projeto mora e tem 1 frase por fato', () => {
    const l = linhas(base());
    assert.match(l[0], /^A oficina onde o projeto mora/);
    const corpo = l.slice(1).filter((x) => x.startsWith('- '));
    assert.equal(corpo.length, 5);
    for (const x of corpo) assert.ok(x.endsWith('.') && !x.slice(2, -1).includes('. '), `1 frase: ${x}`);
    // sem a fonte nem o estado técnico
    for (const x of l) assert.doesNotMatch(x, /fonte|detectado|nao_detectado|ambiguo/);
  });

  test('cada frase carrega o valor do fato: trocar o valor troca a frase', () => {
    const a = linhas(base()).join('\n');
    assert.match(a, /producao-eu/);
    assert.match(a, /clickup/);
    assert.match(a, /trunk/);
    assert.match(a, /\b7\b/);
    assert.match(a, /\b9\b/);
    const b = base();
    b[0] = it('tipo_repo', 'detectado', 'repo-sem-app');
    b[1] = it('ambientes', 'detectado', { producao: 'live', outros: [] });
    b[2] = it('planejamento', 'detectado', { ferramenta: 'linear', mcp: null });
    b[3] = it('versionamento', 'detectado', 'main');
    b[4] = it('orquestracao', 'detectado', { simultaneos: 2, teto: 8 });
    const t = linhas(b).join('\n');
    assert.match(t, /live/); assert.doesNotMatch(t, /producao-eu/);
    assert.match(t, /linear/); assert.doesNotMatch(t, /clickup/);
    assert.match(t, /main/); assert.doesNotMatch(t, /trunk/);
    assert.match(t, /\b2\b/); assert.match(t, /\b8\b/); assert.doesNotMatch(t, /\b7\b|\b9\b/);
    assert.notEqual(linhas(b)[1], linhas(base())[1], 'app × sem app');
    assert.doesNotMatch(linhas(b)[1], /aplicativo ou site/);
    assert.match(linhas(base())[1], /aplicativo ou site/);
  });

  test('fato aberto: "vou perguntar" só com pergunta para ele; sem pergunta fica em aberto; nunca inventa valor', () => {
    const itens = [
      it('tipo_repo', 'ambiguo', 'app', ['app', 'repo-sem-app']),
      it('ambientes', 'nao_detectado', null),
      it('planejamento', 'ambiguo', 'linear', ['linear', 'clickup']),
      it('versionamento', 'nao_detectado', null, ['main']),
      it('orquestracao', 'detectado', { simultaneos: 3, teto: 5 }),
    ];
    const perguntados = [...tres, { id: 'tipo_repo' }, { id: 'planejamento' }];
    const l = linhas(itens, perguntados).filter((x) => x.startsWith('- '));
    assert.equal(l.length, 5);
    assert.match(l[0], /vou perguntar/);
    assert.match(l[2], /vou perguntar/);
    assert.match(l[1], /em aberto/); assert.doesNotMatch(l[1], /perguntar/);
    assert.match(l[3], /em aberto/); assert.doesNotMatch(l[3], /perguntar/);
    assert.doesNotMatch(l.join('\n'), /linear|clickup|\bmain\b/, 'não escolhe pelo dono');
    assert.doesNotMatch(l[4], /perguntar|em aberto/);
    // sem nenhuma pergunta de item: nenhum "vou perguntar"
    assert.doesNotMatch(linhas(itens, tres).join('\n'), /vou perguntar/);
  });

  test('diz quantas perguntas vêm e como ver os detalhes', () => {
    const a = previaSimples(base(), tres);
    const b = previaSimples(base(), cinco);
    assert.match(a, /3 perguntas/);
    assert.match(b, /5 perguntas/);
    assert.match(a, /mostrar detalhes/);
    assert.notEqual(a, b);
  });

  test('a prévia simples não usa termo do glossário (a explicação vem nas perguntas)', () => {
    const txt = previaSimples(base(), cinco).toLowerCase();
    for (const g of GLOSSARIO) assert.equal(txt.includes(g.termo.toLowerCase()), false, g.termo);
  });

  test('valor de forma inesperada num fato "detectado" não vira frase com "undefined": cai no "não deu para saber"', () => {
    const feios = [
      it('tipo_repo', 'detectado', { x: 1 }),
      it('ambientes', 'detectado', 'producao'),
      it('planejamento', 'detectado', null),
      it('versionamento', 'detectado', { nome: 'main' }),
      it('orquestracao', 'detectado', { simultaneos: '3', teto: 5 }),
    ];
    const l = linhas(feios).filter((x) => x.startsWith('- '));
    assert.equal(l.length, 5);
    for (const x of l) assert.match(x, /^- Não deu para saber/, x);
    assert.doesNotMatch(l.join('\n'), /undefined|null|\[object/);
    // sem itens e sem perguntas (dado ausente): só o cabeçalho e o rodapé, sem quebrar
    const vazio = previaSimples(undefined, undefined);
    assert.match(vazio, /^A oficina onde o projeto mora/);
    assert.match(vazio, /0 perguntas rápidas/);
  });

  test('item que o onboarding não conhece não quebra nem some', () => {
    const l = linhas([...base(), it('novo_item', 'detectado', 'x')]).filter((x) => x.startsWith('- '));
    assert.equal(l.length, 6);
  });
});

describe('CLI detectar', () => {
  const bin = () => { const b = novoDir(); writeFileSync(join(b, 'claude'), '#!/bin/sh\necho "outro: cmd - ✔ Connected"\n'); chmodSync(join(b, 'claude'), 0o755); return b; };
  const detectarCli = (raiz) => {
    const r = spawnSync(process.execPath, [CLI, 'detectar', '--root', raiz, '--hoje', HOJE, '--fuso', 'UTC'], { encoding: 'utf8', env: { ...process.env, PATH: `${bin()}:${process.env.PATH}` } });
    return JSON.parse(r.stdout);
  };

  test('a saída traz previaSimples (padrão) e a prévia técnica intacta em `previa` (campo mantido)', () => {
    for (const [nome, monta] of Object.entries(CASOS)) {
      const { raiz } = monta();
      const out = detectarCli(raiz);
      assert.equal(out.ok, true, nome);
      assert.equal(typeof out.previaSimples, 'string', nome);
      assert.match(out.previaSimples, /^A oficina onde o projeto mora/, nome);
      assert.ok(out.previa.startsWith('detectei:'), nome);
      assert.deepEqual(acharProibidos(out.previaSimples), [], nome);
      assert.match(out.previaSimples, new RegExp(`${out.perguntas.length} perguntas`), nome);
      for (const p of out.perguntas) { assert.ok(tam(p.texto) <= 160, p.id); for (const o of p.opcoes) assert.ok(tam(o.rotulo) <= 60, o.rotulo); }
      assert.deepEqual(acharProibidos(out.perguntas.flatMap((p) => [p.texto, ...p.opcoes.map((o) => o.rotulo)]).join(' ')), [], nome);
    }
  });
});

describe('prévia técnica', () => {
  test('previa-tecnica-intacta: o texto da 2.0.0, byte a byte, com o fato de cada linha', () => {
    const esperado = 'detectei:\n- tipo_repo: ambiguo app (fonte: x)\n- ambientes: ambiguo prod (fonte: x); ambientes: informativo; a guarda usa guarda.ambientes\n- planejamento: ambiguo linear (fonte: x)\n- versionamento: ambiguo main (fonte: x)\n- orquestracao: nao_detectado (fonte: x)\n\ndecido com você (default entre colchetes):\n- política de entrega: sob_demanda\n- autonomia em produção: não\n- perfil de modelos: padrao\n- janela padrão, se a política for "janela" e o config não tiver uma: dias 1,2,3,4,5, 09:00-17:00, fuso America/Sao_Paulo\n\nfatos que preciso de você:\n- tipo_repo: pergunto (default app)\n- ambientes: pergunto (default prod)\n- planejamento: fica nao_detectado (acima do teto de 5 perguntas); nada é gravado para ele\n- versionamento: fica nao_detectado (acima do teto de 5 perguntas); nada é gravado para ele\n- orquestracao: sem opção para escolher; fica nao_detectado e nada é gravado para ele (trocar orquestracao depois)\n\nPara trocar um item depois: trocar <item> (tipo_repo, ambientes, planejamento, versionamento, orquestracao).';
    assert.equal(previa(ITENS_ABERTOS, perguntas(ITENS_ABERTOS, null), { fuso: FUSO }), esperado);
  });
});

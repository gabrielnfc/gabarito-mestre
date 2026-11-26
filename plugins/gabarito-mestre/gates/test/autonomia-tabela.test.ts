/**
 * GM-22 T3 (REQ-PUB-2, REQ-PUB-3; DT2, DT3, DT6, DT7, DT8): a tabela de decisão da autonomia, categoria × 3 níveis × 2 papéis.
 * A autonomia (`nivel: 'publica'`) cala SÓ publicar; `trabalha` e `nenhuma` não calam nada; o subagente não muda nunca.
 *
 * MUTAÇÕES PRESCRITAS:
 *  MP2-a  voltar a calar todo `ask` não segredo (o `decidir` de 2.2.2) ⇒ `tabela-decisao-autonomia` e `publica-nao-cala-terceiro-delete-integridade` falham
 *  MP2-b  calar publicar com `trabalha` ⇒ `trabalha-nao-cala-publicar` falha
 *  MP2-c  calar publicar destrutivo ⇒ a linha "destrutivo" da tabela (`git push --force origin main`) falha
 *  MP2-e  calar a escrita no interruptor com `publica` ⇒ a linha "integridade" (interruptor) falha
 *  MP2-f  subagente com `publica` passa ⇒ `subagente-igual-nos-3-niveis` e a tabela falham
 *  MP3-a  sufixo do motivo com nível `nenhuma` ⇒ `motivo-igual-sem-autonomia` falha
 *  MP3-b  sufixo no `deny` do subagente ⇒ `motivo-subagente-igual` falha
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decidir } from '../src/decidir.ts';
import { TETO_COMANDO } from '../src/aneis.ts';
import type { ConfigGuarda, Contexto, Decisao, EntradaHook } from '../src/tipos.ts';

type Nivel = 'nenhuma' | 'trabalha' | 'publica';
const NIVEIS: Nivel[] = ['nenhuma', 'trabalha', 'publica'];

const CFG = {
  ambientes: {
    teste: { hosts: ['localhost'], bancos: ['localhost'] },
    prod: { hosts: ['api.exemplo.com'], bancos: ['db.prod.exemplo.com'], mcps: ['mcp__banco_prod__'], projetos: ['refprod'], variaveis: ['PROD_DB'], branches: ['main'] },
  },
  permitidos: [],
} as unknown as ConfigGuarda;

const ctx = (branchAtual: string): Contexto => ({ branchAtual, refLinkado: null, remoteUrl: 'git@github.com:org/app.git', raiz: '/repo', pluginRoot: '/plugin' });
// O caminho do interruptor entra por concatenação para a linha do teste não citar o arquivo inteiro.
const INTERRUPTOR = `/home/u/.claude/${'gabarito-'}${'autonomia'}.json`;

const SUFIXO = ' · autonomia (2.3.1): cala só publicar (push e merge na branch de produção, deploy), e só com a resposta "publica"; produção de terceiro, delete em massa, harness e push sem hooks sempre perguntam';

type Caso = { tool: string; input: Record<string, unknown>; branch?: string };
const bash = (command: string, branch?: string): Caso => ({ tool: 'Bash', input: { command }, branch });

function entradaDe(c: Caso, sub: boolean): EntradaHook {
  return { tool_name: c.tool, tool_input: c.input, permission_mode: 'default', session_id: 's', cwd: '/repo', ...(sub ? { agent_id: 'a1' } : {}) };
}
function rodar(c: Caso, nivel: Nivel, sub = false): Decisao {
  return decidir(entradaDe(c, sub), CFG, ctx(c.branch ?? 'feat/x'), nivel);
}
const tipoEsperado = { ask: 'guarda.ask', deny: 'guarda.deny' } as const;

type Linha = { categoria: string; casos: Caso[]; orq: { nenhuma: 'ask' | 'silencio'; trabalha: 'ask' | 'silencio'; publica: 'ask' | 'silencio' }; sub: 'deny' | 'silencio' };
const PEDE = { nenhuma: 'ask', trabalha: 'ask', publica: 'ask' } as const;
const IGUAL = { nenhuma: 'silencio', trabalha: 'silencio', publica: 'silencio' } as const;

const LINHAS: Linha[] = [
  { categoria: 'segredo', casos: [bash('cat .env'), { tool: 'Read', input: { file_path: '/repo/.env' } }], orq: PEDE, sub: 'deny' },
  {
    categoria: 'integridade do harness',
    casos: [
      { tool: 'Write', input: { file_path: '/repo/harness.config.json', content: '{}' } },
      bash('git remote add x y'),
      bash('git pull'),
      { tool: 'Write', input: { file_path: INTERRUPTOR, content: '{}' } }, // DT6: escrita no interruptor pede sempre
      bash(`echo x > ${INTERRUPTOR}`),
    ],
    orq: PEDE,
    sub: 'deny',
  },
  { categoria: 'hooks do git', casos: [{ tool: 'Edit', input: { file_path: '.githooks/pre-push', old_string: 'a', new_string: 'b' } }, { tool: 'Write', input: { file_path: '.husky/pre-push', content: 'x' } }, bash('rm -rf .husky')], orq: PEDE, sub: 'deny' },
  { categoria: 'push sem hooks', casos: [bash('git push --no-verify origin feat/x'), bash('GIT_CONFIG_COUNT=1 git push origin feat/x'), bash('git push --no-verify origin main')], orq: PEDE, sub: 'deny' },
  {
    categoria: 'produção de terceiro',
    casos: [bash('psql -h db.prod.exemplo.com -c "select 1"'), bash('curl https://api.exemplo.com/x'), bash('vercel env pull --prod'), { tool: 'mcp__banco_prod__execute_sql', input: { query: 'select 1' } }],
    orq: PEDE,
    sub: 'deny',
  },
  {
    categoria: 'delete em massa / destrutivo em prod',
    casos: [bash('psql -h db.prod.exemplo.com -c "DELETE FROM t"'), bash('git push --force origin main'), bash('git push --delete origin main'), bash('git push origin +x:main')],
    orq: PEDE,
    sub: 'deny',
  },
  {
    categoria: 'publicar',
    casos: [bash('git push origin main'), bash('git push -u origin main'), bash('gh pr merge 5', 'main'), bash('vercel --prod'), bash('vercel promote x')],
    orq: { nenhuma: 'ask', trabalha: 'ask', publica: 'silencio' },
    sub: 'deny',
  },
  {
    categoria: 'comando misto',
    casos: [bash('git push origin main && psql -h db.prod.exemplo.com -c "select 1"'), bash('npm test && git push origin main'), bash('git push origin main; git remote add x y')],
    orq: PEDE,
    sub: 'deny',
  },
  {
    categoria: 'teto, cd perdido',
    casos: [bash(`echo ${'a'.repeat(TETO_COMANDO + 1)}`), bash(`${'cd a;'.repeat(2100)} cd /repo/.git; echo x > config`)],
    orq: PEDE,
    sub: 'deny',
  },
  { categoria: 'fora de anel e de prod', casos: [bash('git push origin feat/x'), bash('ls')], orq: IGUAL, sub: 'silencio' },
];

const rotulo = (c: Caso) => `${c.tool} ${JSON.stringify(c.input).slice(0, 70)}`;

describe('tabela-decisao-autonomia', () => {
  for (const l of LINHAS) {
    test(`linha: ${l.categoria}`, () => {
      assert.ok(l.casos.length >= 2, 'cada categoria tem 2 ou mais exemplos');
      for (const c of l.casos) {
        for (const nivel of NIVEIS) {
          const o = rodar(c, nivel);
          const ctxMsg = `${l.categoria} · ${rotulo(c)} · orquestrador · ${nivel}`;
          const faixa = l.orq[nivel];
          assert.equal(o.faixa, faixa, ctxMsg);
          if (faixa === 'ask') {
            assert.equal(o.permissionDecision, 'ask', ctxMsg);
            assert.equal(o.evento?.tipo, tipoEsperado.ask, ctxMsg);
          } else if (l.categoria === 'publicar') {
            assert.equal(o.permissionDecision, undefined, ctxMsg);
            assert.equal(o.evento?.tipo, 'guarda.autonomia_usada', ctxMsg);
            assert.deepEqual(Object.keys(o.evento?.dados ?? {}).sort(), ['acao', 'alvo', 'ambiente'], ctxMsg);
            assert.equal(JSON.stringify(o.evento).includes(String(c.input.command ?? '\u0000')), false, `${ctxMsg}: nunca o comando`);
            assert.equal(o.classificacao.publicar, true, ctxMsg);
          } else {
            assert.equal(o.permissionDecision, undefined, ctxMsg);
            assert.equal(o.evento, null, ctxMsg);
          }
          const s = rodar(c, nivel, true);
          const sMsg = `${l.categoria} · ${rotulo(c)} · subagente · ${nivel}`;
          assert.equal(s.faixa, l.sub, sMsg);
          if (l.sub === 'deny') {
            assert.equal(s.permissionDecision, 'deny', sMsg);
            assert.equal(s.evento?.tipo, tipoEsperado.deny, sMsg);
          } else {
            assert.equal(s.permissionDecision, undefined, sMsg);
            assert.equal(s.evento, null, sMsg);
          }
        }
      }
    });
  }
});

const semSufixo = (m: string | null) => (m === null ? null : m.replace(SUFIXO, ''));
const NAO_PUBLICAR = LINHAS.filter((l) => l.categoria !== 'publicar' && l.categoria !== 'fora de anel e de prod');

describe('autonomia-so-publica-cala', () => {
  test('publica-nao-cala-terceiro-delete-integridade: troca de valor, `publica` decide igual a `nenhuma` fora de publicar', () => {
    for (const l of NAO_PUBLICAR) {
      for (const c of l.casos) {
        const a = rodar(c, 'nenhuma');
        const b = rodar(c, 'publica');
        const m = `${l.categoria} · ${rotulo(c)}`;
        assert.equal(b.faixa, a.faixa, m);
        assert.equal(b.permissionDecision, a.permissionDecision, m);
        assert.equal(b.evento?.tipo, a.evento?.tipo, m);
        assert.deepEqual(b.evento?.dados, a.evento?.dados, m);
        assert.equal(semSufixo(b.motivo), a.motivo, m);
      }
    }
  });

  test('trabalha-nao-cala-publicar: `trabalha` decide igual a `nenhuma` em toda linha, publicar incluso', () => {
    for (const l of LINHAS) {
      for (const c of l.casos) {
        const a = rodar(c, 'nenhuma');
        const b = rodar(c, 'trabalha');
        const m = `${l.categoria} · ${rotulo(c)}`;
        assert.equal(b.faixa, a.faixa, m);
        assert.equal(b.evento?.tipo, a.evento?.tipo, m);
        assert.notEqual(b.evento?.tipo, 'guarda.autonomia_usada', m);
        assert.equal(semSufixo(b.motivo), a.motivo, m);
      }
    }
    for (const c of LINHAS.find((l) => l.categoria === 'publicar')!.casos) assert.equal(rodar(c, 'trabalha').faixa, 'ask', rotulo(c));
  });

  test('subagente-igual-nos-3-niveis: faixa, decisão, evento e motivo idênticos (publicar incluso)', () => {
    for (const l of LINHAS) {
      for (const c of l.casos) {
        const base = rodar(c, 'nenhuma', true);
        for (const nivel of ['trabalha', 'publica'] as const) {
          const d = rodar(c, nivel, true);
          const m = `${l.categoria} · ${rotulo(c)} · ${nivel}`;
          assert.equal(d.faixa, base.faixa, m);
          assert.equal(d.permissionDecision, base.permissionDecision, m);
          assert.equal(d.evento?.tipo, base.evento?.tipo, m);
          assert.deepEqual(d.evento?.dados, base.evento?.dados, m);
          assert.equal(d.motivo, base.motivo, m);
        }
      }
    }
  });

  test('padrão do 4º parâmetro é `nenhuma`: sem nível, publicar pede', () => {
    const c = bash('git push origin main');
    assert.equal(decidir(entradaDe(c, false), CFG, ctx('feat/x')).faixa, 'ask');
  });
});

describe('motivo e aviso de compatibilidade (REQ-PUB-3)', () => {
  const todos = LINHAS.flatMap((l) => l.casos.map((c) => ({ l, c })));

  test('motivo-avisa-com-autonomia: todo `ask` do orquestrador com `trabalha` ou `publica` termina no texto fixo', () => {
    for (const { l, c } of todos) {
      for (const nivel of ['trabalha', 'publica'] as const) {
        const d = rodar(c, nivel);
        if (d.faixa !== 'ask') continue;
        const base = rodar(c, 'nenhuma').motivo;
        assert.ok(typeof base === 'string' && base !== '', `${l.categoria} · ${rotulo(c)}`);
        assert.equal(d.motivo, `${base}${SUFIXO}`, `${l.categoria} · ${rotulo(c)} · ${nivel}`);
        assert.ok(d.motivo!.endsWith(SUFIXO));
      }
    }
  });

  test('motivo-igual-sem-autonomia: nível `nenhuma` devolve byte a byte o motivo de hoje', () => {
    assert.equal(rodar(bash('cat .env'), 'nenhuma').motivo, 'segredo em .env exige confirmação humana');
    assert.equal(rodar(bash('git remote add x y'), 'nenhuma').motivo, 'integridade em .git/config exige confirmação humana');
    assert.equal(rodar(bash('git push origin main'), 'nenhuma').motivo, 'escrita em PRODUÇÃO em main exige confirmação humana');
    assert.equal(rodar(bash('psql -h db.prod.exemplo.com -c "select 1"'), 'nenhuma').motivo, 'leitura em PRODUÇÃO em db.prod.exemplo.com exige confirmação humana');
    assert.equal(rodar(bash(`echo ${'a'.repeat(TETO_COMANDO + 1)}`), 'nenhuma').motivo, 'comando acima de 64 KB: a guarda só lê o início e não consegue inspecionar o resto; reduza ou grave o script por Write');
    for (const { l, c } of todos) assert.equal((rodar(c, 'nenhuma').motivo ?? '').includes('autonomia (2.3.1)'), false, `${l.categoria} · ${rotulo(c)}`);
  });

  test('motivo-subagente-igual: o deny do subagente não ganha sufixo em nenhum nível', () => {
    assert.equal(rodar(bash('git remote add x y'), 'publica', true).motivo, 'integridade em .git/config: só o orquestrador pode pedir; subagent não opera aqui');
    for (const { l, c } of todos) {
      for (const nivel of NIVEIS) assert.equal((rodar(c, nivel, true).motivo ?? '').includes('autonomia (2.3.1)'), false, `${l.categoria} · ${rotulo(c)} · ${nivel}`);
    }
  });

  test('o sufixo não entra no evento nem no que silencia', () => {
    const d = rodar(bash('git push origin main'), 'publica');
    assert.equal(d.faixa, 'silencio');
    assert.equal(d.motivo, null);
    assert.equal(JSON.stringify(d.evento).includes('autonomia (2.3.1)'), false);
    const a = rodar(bash('cat .env'), 'publica');
    assert.equal(JSON.stringify(a.evento).includes('autonomia (2.3.1)'), false);
  });
});

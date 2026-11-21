/**
 * Testes de `origem.ts` (GM-14 T4, REQ-LNG-1 núcleo): origem por tabela fechada, normalização de nome/tag e regex técnica.
 * Mutações (.superpowers/sdd/2026-11-11-proxima/task-4-mut.json):
 *  M-T4a  `tagNatural` devolve a tag crua              ⇒ `tag-v200-normalizada` falha
 *  M-T4b  tipo novo cai em `(automático)`              ⇒ `tipo-fora-da-tabela-null` falha
 *  M-T4c  `nomeNatural` troca todo `.` por espaço      ⇒ `nome-natural-ponto-so-antes-de-letra` falha (DP-4)
 *  M-T4d  `linhaTecnica` ignora TipoEvento/MotivoParar ⇒ `linha-tecnica-tipo-e-motivo-como-palavra` falha
 *  M-T4j  palavra de tipo sensível a caixa (sem flag `i`) ⇒ `palavra-tipo-qualquer-caixa` falha
 * GM-18 T1: M1c e M1d ⇒ `origem-encerrada-dono-voce` (a lista M1a..M1g completa está em formas.test.ts)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linhaTecnica, nomeNatural, origemDe, REGEX_TECNICA, tagNatural } from '../src/origem.ts';
import { MOTIVOS_PARAR, TIPOS_EVENTO } from '../src/formas.ts';
import type { Evento, TipoEvento } from '../src/tipos.ts';

const H = 'a'.repeat(64);
const ev = (tipo: string, dados: Record<string, unknown> = {}): Evento => ({
  seq: 1, ts: '2026-11-11T10:00:00.000Z', autor: 'orquestrador', sessao: 's1', agente: 'principal', tipo: tipo as TipoEvento, dados, hash_anterior: null,
});

const AUTO = '(automático)';
const ORQ = '(anotado pelo orquestrador)';
const VOCE = '(você)';

// ── origemDe ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('origem-tabela-cada-tipo', () => {
  // Toda linha da tabela fechada, lendo o texto devolvido; e TODO tipo do contrato tem expectativa (tipo novo sem decisão falha aqui).
  const esperado: Record<string, string | null> = {
    'producao.acesso': null, 'operacao.destrutiva': null, 'guarda.deny': null, 'guarda.ask': null,
    'sessao.inicio': AUTO, 'guarda.heartbeat': null, 'diario.recusa': null,
    'task.iniciada': AUTO, 'task.concluida': AUTO, 'review.veredito': AUTO, 'task.integrada': AUTO, 'task.reaberta': AUTO,
    'ci.resultado': AUTO, 'loop.parar': null, 'loop.pausa': null, 'custo.medicao': null,
    'sessao.pouso': AUTO, 'sessao.pouso.tentativa': AUTO, 'sessao.retomada': AUTO,
    'sombra.consulta': null, 'decisao.sombra': ORQ, 'desvio': null, 'descoberta': null,
    'emenda.proposta': null, 'spec.emendada': null, 'emenda.rejeitada': null,
    'entrega.inicio': AUTO, 'entrega.smoke': AUTO, 'entrega.rollback': AUTO, 'entrega.fim': AUTO, 'entrega.agendada': AUTO,
    'spec.aprovada': VOCE, 'spec.aplicada': ORQ, 'entrega.devolvida': AUTO,
    'aprendizado': null, 'aprendizado.nada': null, 'dono.mensagem': null,
    'fato.medido': AUTO, 'nota': ORQ, 'dono.resposta': '(você respondeu: Sim)',
    'task.fora': VOCE, 'entrega.encerrada': AUTO, 'entrega.reaberta': VOCE, 'guarda.autonomia_usada': AUTO,
  };
  assert.deepEqual(Object.keys(esperado).sort(), [...TIPOS_EVENTO].sort(), 'cada TipoEvento tem expectativa explícita');
  const dados: Record<string, Record<string, unknown>> = {
    'task.reaberta': { task: 'T1', origem: 'retomada' },
    'dono.resposta': { pergunta: 's1:3', opcao: 1, rotulo: 'Sim' },
    'task.fora': { task: 'T5', como: 'adiada', motivo: 'm', origem: 'dono' },
  };
  for (const tipo of TIPOS_EVENTO) {
    assert.equal(origemDe(ev(tipo, dados[tipo] ?? {})), esperado[tipo], tipo);
  }
});

test('dono-mensagem-sem-origem', () => {
  for (const dados of [{}, { sha256: H, chars: 12 }, { texto: 'oi' }, { rotulo: 'Sim', opcao: 1 }]) {
    assert.equal(origemDe(ev('dono.mensagem', dados)), null, JSON.stringify(dados));
  }
});

test('tipo-fora-da-tabela-null', () => {
  // Prefixo da tabela NÃO basta: a tabela é fechada. Tipo novo/inventado de qualquer família ⇒ null (nunca `(automático)` por padrão).
  for (const tipo of ['task.inventada', 'entrega.inventada', 'sessao.inventada', 'fato.inventado', 'nota.extra', 'tipo.qualquer', 'review', '', 'dono.resposta2']) {
    assert.equal(origemDe(ev(tipo)), null, JSON.stringify(tipo));
  }
  // Total: nunca lança, mesmo com entrada malformada.
  for (const ruim of [null, undefined, {}, { tipo: 42 }, 'nota', 7]) assert.equal(origemDe(ruim as unknown as Evento), null, JSON.stringify(ruim));
});

test('resposta-com-rotulo', () => {
  const r = (dados: Record<string, unknown>) => origemDe(ev('dono.resposta', dados));
  assert.equal(r({ pergunta: 's1:3', opcao: 2, rotulo: 'Aprovar a spec' }), '(você respondeu: Aprovar a spec)');
  assert.equal(r({ pergunta: 's1:3', opcao: 1, rotulo: 'Conversa avulsa' }), '(você respondeu: Conversa avulsa)'); // troca de rótulo ⇒ troca de saída
  assert.equal(r({ pergunta: 'herdar:' + 'ab12cd34', opcao: 1, rotulo: 'Vale' }), '(você respondeu: Vale)');
  // Digitada: nunca texto (só hash), então sem origem exibível.
  assert.equal(r({ pergunta: 's1:3', sha256: H, chars: 14 }), null);
  // Formas inválidas falham fechado (nada de `undefined` no texto): rótulo ausente, vazio, opção fora de 1..4, formas misturadas, campo extra.
  assert.equal(r({ pergunta: 's1:3', opcao: 1 }), null);
  assert.equal(r({ pergunta: 's1:3', opcao: 1, rotulo: '  ' }), null);
  assert.equal(r({ pergunta: 's1:3', opcao: 0, rotulo: 'Sim' }), null);
  assert.equal(r({ pergunta: 's1:3', opcao: 5, rotulo: 'Sim' }), null);
  assert.equal(r({ pergunta: 's1:3', opcao: 1, rotulo: 'Sim', sha256: H, chars: 3 }), null);
  assert.equal(r({ pergunta: 's1:3', opcao: 1, rotulo: 'Sim', texto: 'livre' }), null);
  assert.equal(r({ pergunta: 's1:3', opcao: 1, rotulo: 'Sim\nNão' }), null);
  assert.equal(r({}), null);
});

test('task-reaberta-dono-x-retomada', () => {
  const r = (dados: Record<string, unknown>) => origemDe(ev('task.reaberta', dados));
  assert.equal(r({ task: 'T1', origem: 'dono' }), VOCE);
  assert.equal(r({ task: 'T1', origem: 'retomada' }), AUTO);
  assert.equal(r({ task: 'T1' }), AUTO); // sem origem declarada: nunca atribuir ao dono
  assert.equal(r({ task: 'T1', origem: 'Dono' }), AUTO);
  // GM-14 T36 (FIEL-15, furo 8): a liberação da Sombra sai como dela, nunca `(automático)` nem `(você)`
  assert.equal(r({ task: 'T1', origem: 'sombra' }), '(Sombra)');
  assert.equal(r({ task: 'T1', origem: 'sombra', hash: 'e'.repeat(64) }), '(Sombra)');
  // Só `task.reaberta` carrega `origem:'dono'` ⇒ `(você)`; as outras `task.*` ignoram o campo.
  assert.equal(origemDe(ev('task.integrada', { task: 'T1', origem: 'dono' })), AUTO);
  assert.equal(origemDe(ev('spec.aprovada', { origem: 'retomada' })), VOCE);
});

// ── nomeNatural / tagNatural ──────────────────────────────────────────────────────────────────────────────────────────────────

test('true-force-normalizado', () => {
  assert.equal(nomeNatural('true_force'), 'true force');
  assert.equal(nomeNatural('True-Force'), 'True Force');
  assert.equal(nomeNatural('true--force__x'), 'true force x');
  assert.equal(nomeNatural('  _true_force-  '), 'true force');
  assert.equal(nomeNatural('Gabarito Mestre'), 'Gabarito Mestre');
  assert.equal(nomeNatural(''), '');
  assert.equal(nomeNatural('a   b\t c'), 'a b c');
});

test('tag-v200-normalizada', () => {
  assert.equal(tagNatural('gabarito-mestre--v2.0.0'), '2.0.0');
  assert.equal(tagNatural('v2.1.0'), '2.1.0');
  assert.equal(tagNatural('2.1.0'), '2.1.0');
  assert.equal(tagNatural('release-10.20.30'), '10.20.30');
  assert.equal(tagNatural('gabarito-mestre--v3.4.5'), '3.4.5'); // troca de valor: segue o número, não o exemplo
  // Sem X.Y.Z ⇒ null (nunca devolve a tag crua).
  for (const t of ['latest', 'v2.0', 'v2', 'gabarito-mestre', '', 'v1.2.3.4', 'x.y.z']) assert.equal(tagNatural(t), null, JSON.stringify(t));
  assert.equal(tagNatural(undefined as unknown as string), null);
});

test('nome-com-ponto-e-sublinhado', () => {
  assert.equal(nomeNatural('meu_app.config'), 'meu app config');
  assert.equal(nomeNatural('notas.md'), 'notas md');
  assert.equal(nomeNatural('file1.md'), 'file1 md');
  assert.equal(nomeNatural('loop.tetoTokens'), 'loop tetoTokens');
  for (const nome of ['meu_app.config', 'notas.md', 'file1.md', 'plano.json', 'meu-app_v2.mjs']) {
    assert.equal(linhaTecnica(nome), true, `${nome} cru é técnico`);
    assert.equal(linhaTecnica(nomeNatural(nome)), false, `${nome} normalizado não é`);
  }
});

test('nome-natural-ponto-so-antes-de-letra', () => {
  // DP-4: preserva número/versão; só o ponto seguido de letra vira espaço.
  assert.equal(nomeNatural('versão 2.1.0'), 'versão 2.1.0');
  assert.equal(nomeNatural('3.14'), '3.14');
  assert.equal(nomeNatural('v1.2.3-beta'), 'v1.2.3 beta');
  assert.equal(nomeNatural('a.b'), 'a b');
  assert.equal(nomeNatural('fim.'), 'fim.');
  assert.equal(nomeNatural('app.2'), 'app.2');
  assert.equal(nomeNatural('x.1.md'), 'x.1 md');
});

test('nome-natural-propriedade-nunca-tecnica', () => {
  // Propriedade (enumerada, sem acaso): nome do alfabeto [A-Za-z0-9._-] normalizado nunca casa a regex técnica (sem a palavra `node`).
  const pedacos = ['meu', 'app', 'Config', 'notas', 'md', 'json', 'mjs', 'v2', '1', '0', 'x'];
  const seps = ['_', '-', '.', '--', '._', ''];
  let n = 0;
  for (const a of pedacos) for (const b of pedacos) for (const s of seps) for (const t of seps) for (const c of ['', 'z', '9']) {
    const nome = `${a}${s}${b}${t}${c}`;
    const r = nomeNatural(nome);
    assert.equal(linhaTecnica(r), false, `${JSON.stringify(nome)} → ${JSON.stringify(r)}`);
    n++;
  }
  assert.ok(n > 1000);
});

// ── id de entrega ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('id-de-entrega-intacto', () => {
  // DP-4: ID de entrega nunca passa por `nomeNatural` (ele o estragaria: "GM 14" não é mais o ID da branch/ledger). Por isso o ID cru
  // não pode ser técnico: o render o usa como está.
  for (const id of ['GM-14', 'GM-7', 'PBI-123', 'ABC-1', 'TF-2026']) {
    assert.equal(linhaTecnica(id), false, id);
    assert.equal(linhaTecnica(`entrega ${id} · fase 3 de 7`), false, id);
    assert.equal(linhaTecnica(`pergunta sobre a ${id}`), false, id);
  }
  // E a normalização o quebraria: documenta por que o chamador não pode aplicá-la ao ID.
  assert.notEqual(nomeNatural('GM-14'), 'GM-14');
});

// ── linhaTecnica ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('regex-tecnica-literal', () => {
  assert.equal(REGEX_TECNICA.source, String.raw`[`+'`'+String.raw`]|--|\/[a-z]|\bnode\b|\.(json|mjs|md)\b|[a-z]+_[a-z_]+|[a-z]+\.[a-z]+\b`);
  assert.equal(REGEX_TECNICA.flags, ''); // sem `g`/`y`: `.test` sem estado entre chamadas
});

test('linha-tecnica-casos', () => {
  for (const t of ['/gabarito', '--x', 'node', 'a.json', 'loop.tetoTokens', 'sem_loop', 'rode `isto`', 'abre x.md', 'use node 22', 'a.mjs', 'aprovar /spec']) {
    assert.equal(linhaTecnica(t), true, t);
  }
  for (const t of ['fase 3 de 7', 'Spec aprovada (você)', 'faltam 4 de 9 tarefas', 'versão 2.1.0', 'nó de rede', 'pergunta aberta (+1)', '']) {
    assert.equal(linhaTecnica(t), false, t);
  }
  // Ponto entre letras fora do alcance da regex literal (camelCase/maiúscula; o `\b` falha): complemento de `linhaTecnica`, REGEX_TECNICA fica literal.
  assert.equal(REGEX_TECNICA.test('loop.tetoTokens'), false);
  for (const t of ['loop.tetoTokens', 'Loop.Teto', 'usa gates.Painel agora']) assert.equal(linhaTecnica(t), true, t);
  for (const t of ['Fim. Depois da spec', 'faltam 3.5 de 9', 'versão 2.1.0', 'v2.x', 'ok.']) assert.equal(linhaTecnica(t), false, t);
  // Entrada que não é texto: falha fechada (trata como técnica; nunca deixa passar).
  assert.equal(linhaTecnica(undefined as unknown as string), true);
  assert.equal(linhaTecnica(42 as unknown as string), true);
});

test('linha-tecnica-tipo-e-motivo-como-palavra', () => {
  // Cada TipoEvento e MotivoParar, como palavra, torna a linha técnica; troca de valor por vizinho (sufixo/prefixo de letra) a libera.
  for (const t of [...TIPOS_EVENTO, ...MOTIVOS_PARAR]) {
    assert.equal(linhaTecnica(`algo ${t} algo`), true, t);
    assert.equal(linhaTecnica(t), true, t);
    assert.equal(linhaTecnica(`(${t})`), true, t);
    assert.equal(linhaTecnica(`${t}, e mais`), true, t);
  }
  // Só palavras de uma peça interessam aqui: as demais já caem na regex. Vizinhos que NÃO são a palavra:
  for (const t of ['desvio', 'nota', 'descoberta', 'aprendizado', 'smoke', 'rollback']) {
    assert.equal(linhaTecnica(`${t}s`), false, `${t}s`);
    assert.equal(linhaTecnica(`de${t}`), false, `de${t}`);
    assert.equal(linhaTecnica(`${t}ção`), false, `${t}ção`);
    assert.equal(linhaTecnica(`${t}1`), false, `${t}1`);
  }
  assert.equal(linhaTecnica('anotado pelo orquestrador'), false);
  assert.equal(linhaTecnica('denota'), false);
  assert.equal(linhaTecnica('notação'), false);
  assert.equal(linhaTecnica('smoking'), false);
});

test('palavra-tipo-qualquer-caixa', () => {
  // Review r1 MAJOR 1: a caixa não libera a palavra de tipo/motivo.
  for (const t of ['Smoke verde', 'Rollback falhou', 'Nota do orquestrador', 'NOTA', 'TETO_TOKENS', 'Desvio de rota', 'APRENDIZADO registrado', 'sMoKe']) {
    assert.equal(linhaTecnica(t), true, t);
  }
  // Vizinho que continua não sendo a palavra, em qualquer caixa.
  for (const t of ['Smokes', 'NOTAÇÃO', 'Denota', 'ROLLBACK1']) assert.equal(linhaTecnica(t), false, t);
});

test('tag-pre-release-fica-so-com-xyz', () => {
  // Review r1 MINOR 4: decisão fixada (sufixo de pré-release é ignorado), não acidente.
  assert.equal(tagNatural('v2.1.0-rc.1'), '2.1.0');
});

// ── costura: o que o resto consome é o `dist/` ────────────────────────────────────────────────────────────────────────────────

test('dist-origem-mesmo-contrato', async () => {
  // P9: adaptadores `.mjs` importam `dist/origem.js`, não o `.ts`. O contrato passa pela camada real.
  const dist = await import('../dist/origem.js');
  assert.equal(dist.origemDe(ev('dono.resposta', { pergunta: 's1:3', opcao: 2, rotulo: 'Aprovar a spec' })), '(você respondeu: Aprovar a spec)');
  assert.equal(dist.origemDe(ev('task.reaberta', { task: 'T1', origem: 'dono' })), VOCE);
  assert.equal(dist.origemDe(ev('nota', { tipo: 'ideia', texto: 'x' })), ORQ);
  assert.equal(dist.nomeNatural('meu_app.config v2.1.0'), 'meu app config v2.1.0');
  assert.equal(dist.tagNatural('gabarito-mestre--v2.0.0'), '2.0.0');
  assert.equal(dist.linhaTecnica('node'), true);
  assert.equal(dist.linhaTecnica('smoke'), true);
  assert.equal(dist.linhaTecnica('fase 3 de 7'), false);
  assert.equal(dist.REGEX_TECNICA.source, REGEX_TECNICA.source);
});

test('origem-dos-eventos-novos: tabela fechada, (você)/(automático)/(Sombra); origem ilegível ou fora da lista não aparece', () => {
  const SOMBRA = '(Sombra)';
  assert.equal(origemDe(ev('entrega.encerrada', { entrega: 'GM-14', pr: 22, via: 'head', mergeado_em: '2026-11-15T10:00:00.000Z' })), AUTO);
  assert.equal(origemDe(ev('entrega.reaberta', { entrega: 'GM-14', em: '2026-11-15T10:00:00.000Z' })), VOCE);
  assert.equal(origemDe(ev('guarda.autonomia_usada', { anel: 'a', alvo: 'b', acao: 'c', ambiente: 'd' })), AUTO);
  assert.equal(origemDe(ev('task.fora', { task: 'T5', como: 'adiada', motivo: 'm', origem: 'dono' })), VOCE);
  assert.equal(origemDe(ev('task.fora', { task: 'T5', como: 'cortada', motivo: 'm', origem: 'sombra', fonte: 'f' })), SOMBRA);
  for (const o of ['retomada', 'xyz', '', null, undefined, 7]) assert.equal(origemDe(ev('task.fora', { task: 'T5', origem: o as never })), null, JSON.stringify(o));
  assert.equal(origemDe(ev('task.fora', null as never)), null);
  // tipo vizinho inventado continua fora da tabela
  for (const t of ['entrega.encerrada2', 'entrega.reabrir', 'task.fora.x', 'guarda.autonomia']) assert.equal(origemDe(ev(t)), null, t);
});

// ── GM-18 T1 (REQ-ENC-1 iii) ──────────────────────────────────────────────────────────────────────────────────────────────────

test('origem-encerrada-dono-voce', () => {
  const enc = (via: unknown) => origemDe(ev('entrega.encerrada', { entrega: 'GM-13', pr: 16, via, mergeado_em: '2026-11-01T00:00:00.000Z' }));
  assert.equal(enc('dono'), VOCE);
  for (const via of ['head', 'titulo', undefined]) assert.equal(enc(via), AUTO, String(via));
  assert.equal(origemDe({ ...ev('entrega.encerrada'), dados: null as unknown as Record<string, unknown> }), AUTO);
});

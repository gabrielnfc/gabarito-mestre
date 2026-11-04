/**
 * Fumaça sem LLM do loop (GM-10 T22, P9): o caminho inteiro, pelos adaptadores reais, com o modelo por script.
 *
 * Cada cenário sobe um repositório git descartável (TMPDIR do teste) e percorre `loop.mjs`, `guarda.js`, `stop-loop.mjs`,
 * `mod/gabarito.mjs`, `session-card.sh`, git, `npm test` e o gate de `integrar` de verdade; só o host do mod e o modelo são
 * simulados. O `/clear` apaga a memória do modelo (`abertas`, rodada, caminhos): sobram `proxima`, a retomada e o cartão.
 * Foi assim que se acharam D1, D2, D3 e D6 antes de gastar mais uma sessão real (P10).
 *
 * NÃO COBRE, e a sessão real é que mede: o modelo obedecer, `block` × `turn.complete` no host, `$` real.
 *
 * Sem rede, sem LLM, sem relógio decidindo: cada espera é por processo que terminou. Cenários correm em processos próprios
 * (estado de módulo do mod isolado), até 4 por vez.
 *
 * COSTURA (P9): `reprovado-uma-task` atravessa núcleo (`proximaAcao`) → CLI → mod (`tool.call` nega, `turn.complete` reabre e
 * pousa) → hook `Stop` → `/clear` → `session-card.sh` → CLI de novo, tudo pelo adaptador real.
 *
 * MUTAÇÕES PRESCRITAS: `task-22-mut.json` da entrega.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const MOTOR = join(AQUI, 'fumaca-loop', 'caminhada.mjs');
const planos = (n) => join(AQUI, 'fumaca-loop', 'planos', `${n}.json`);

const raizes = [];
after(() => { for (const d of raizes) rmSync(d, { recursive: true, force: true }); });

/** Roda um cenário em processo próprio. Devolve o resultado da caminhada; falha do processo é falha do teste. */
function rodar(opcoes) {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'fumaca-loop-')));
  raizes.push(tmp);
  return new Promise((resolve, reject) => {
    const filho = spawn(process.execPath, [MOTOR, JSON.stringify({ ...opcoes, tmp })], {
      env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('NODE_TEST') && k !== 'NODE_OPTIONS')),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = ''; let err = '';
    filho.stdout.on('data', (b) => { out += b; });
    filho.stderr.on('data', (b) => { err += b; });
    filho.on('error', reject);
    filho.on('close', (rc) => {
      if (rc !== 0) return reject(new Error(`caminhada saiu ${rc}: ${err.slice(-600)}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error(`caminhada sem JSON: ${out.slice(0, 200)} ${err.slice(-300)}`)); }
    });
  });
}

const PREVISTO = /^veredito T\d (APROVADO|REPROVADO) \d \d \d -> (transicao_invalida|achados_ausentes)$/;
const TRILHA = (r) => `\n--- trilha ---\n${r.trilha.join('\n')}`;

/**
 * Asserções comuns a todo cenário (item 5): fim esperado; pouso = retomada; cada pouso com veredito novo antes; guarda sem
 * deny nem ask no caminho de trabalho; `loop.parar` esperado; nenhum `ok:false` fora do previsto; trabalho real (a mutação do
 * revisor derruba a suíte da task, uma vez por veredito); lista de leitura do revisor passa pela guarda.
 */
function conferir(r, e) {
  const m = TRILHA(r);
  assert.equal(r.fim, e.fim, `fim${m}`);
  assert.equal(r.pouso, e.pouso, `pousos${m}`);
  assert.equal(r.retomada, r.pouso, `sessao.pouso = sessao.retomada${m}`);
  assert.equal(r.clears, e.pouso, `um /clear por pouso${m}`);
  assert.deepEqual(r.pousosSemVeredito, e.pousosSemVeredito ?? [], `todo pouso tem veredito novo antes${m}`);
  assert.equal(r.guarda.deny, 0, `guarda deny no caminho de trabalho${m}`);
  assert.equal(r.guarda.ask, 0, `guarda ask no caminho de trabalho${m}`);
  assert.deepEqual(r.parar, e.parar ?? [], `loop.parar${m}`);
  assert.deepEqual(r.defeitos, [], `defeitos (ok:false ou decisão fora do previsto)${m}`);
  for (const p of r.previstos) assert.match(p, PREVISTO, `ok:false previsto${m}`);
  assert.equal(r.integradas, e.integradas, `integradas${m}`);
  assert.equal(r.vereditos, e.vereditos, `vereditos${m}`);
  assert.equal(r.vistos.mutacoesVermelhas, r.vereditos, `a mutação do revisor derruba a suíte, 1 por veredito${m}`);
  assert.ok(r.vistos.specs > 0, `proxima devolve spec (D8)${m}`);
  assert.equal(r.vistos.achados, e.correcoes ?? 0, `cada correção traz os achados da rodada reprovada (D2)${m}`);
  assert.deepEqual(Object.values(r.leituras), Object.values(r.leituras).map(() => 'passa'), `leituras do revisor pela guarda${m}`);
  assert.equal(Object.keys(r.leituras).length, 16, `16 leitores medidos (7 da base + 9 da T21)${m}`);
  if (e.pouso > 0) {
    assert.match(r.retomadaTexto, /gabarito-loop/, `a retomada nomeia a skill (D7)${m}`);
    assert.ok(r.denies >= 1, `o mod negou o Agent antes do pouso${m}`);
  }
  if (e.denies !== undefined) assert.equal(r.denies, e.denies, `Agents negados${m}`);
  if (e.proxima !== undefined) assert.equal(r.proximaFinal.tipo, e.proxima, `proxima final${m}`);
}

describe('fumaça do loop sem LLM', { concurrency: 4 }, () => {
  test('aprovado-uma-task: 1 task aprovada de 1ª chega a concluir sem pouso (D5)', async () => {
    const r = await rodar({ plano: planos('uma') });
    conferir(r, { fim: 'concluir', pouso: 0, integradas: 1, vereditos: 1, proxima: 'concluir', denies: 0 });
  });

  test('reprovado-uma-task: REPROVADO pousa, o /clear apaga a memória e a correção chega a concluir (costura P9, ponte real do dist)', async () => {
    const r = await rodar({ plano: planos('uma'), vereditos: { T1: ['REPROVADO'] } });
    conferir(r, { fim: 'concluir', pouso: 1, integradas: 1, vereditos: 2, correcoes: 1, proxima: 'concluir' });
    assert.ok(r.previstos.some((p) => /transicao_invalida/.test(p)), 'sem memória da rodada depois do /clear, o veredito erra e o CLI diz a esperada (D6)');
    // a ponte real do dist: o `append` do mod roda em `node` de verdade; com ele respondendo ok:false (mutação R8) nada é reaberto
    assert.ok(r.tipos.includes('task.reaberta'), 'o mod desfez o iniciar do Agent negado pela ponte real do dist (D1)');
    assert.deepEqual(r.reabertasDe, ['T1']);
  });

  test('achados vazios: o REPROVADO com arquivo vazio é recusado, nada é gravado, e passa depois de regravado (D2)', async () => {
    const r = await rodar({ plano: planos('uma'), vereditos: { T1: ['REPROVADO'] }, achadosVazios: true });
    conferir(r, { fim: 'concluir', pouso: 1, integradas: 1, vereditos: 2, correcoes: 1, proxima: 'concluir' });
    assert.ok(r.previstos.some((p) => /REPROVADO 1 0 1 -> achados_ausentes/.test(p)), `o CLI recusou o REPROVADO com achados vazios${TRILHA(r)}`);
  });

  test('duas-tasks-em-cadeia: T1 e T3 (T3 depende de T1), aprovadas', async () => {
    const r = await rodar({ plano: planos('cadeia') });
    conferir(r, { fim: 'concluir', pouso: 1, integradas: 2, vereditos: 2, proxima: 'concluir' });
  });

  test('duas-tasks-em-cadeia-reprovada: REPROVADO na dependência, a dependente espera e tudo integra', async () => {
    const r = await rodar({ plano: planos('cadeia'), vereditos: { T1: ['REPROVADO'] } });
    conferir(r, { fim: 'concluir', pouso: 2, integradas: 2, vereditos: 3, correcoes: 1, proxima: 'concluir' });
  });

  test('tres-tasks-aprovado: paralela (T2) e dependente (T3 depende de T1)', async () => {
    const r = await rodar({ plano: planos('tres') });
    conferir(r, { fim: 'concluir', pouso: 1, integradas: 3, vereditos: 3, proxima: 'concluir' });
  });

  test('tres-tasks-reprovado: T1 reprovada, T2 e T3 seguem, 2 pousos', async () => {
    const r = await rodar({ plano: planos('tres'), vereditos: { T1: ['REPROVADO'] } });
    conferir(r, { fim: 'concluir', pouso: 2, integradas: 3, vereditos: 4, correcoes: 1, proxima: 'concluir' });
  });

  test('lote: o iniciar entra depois da negação do Agent e o mod ainda reabre e pousa (D1)', async () => {
    const r = await rodar({ plano: planos('tres'), vereditos: { T1: ['REPROVADO'] }, ordem: 'corrida' });
    conferir(r, { fim: 'concluir', pouso: 2, integradas: 3, vereditos: 4, correcoes: 1, proxima: 'concluir' });
    assert.ok(r.reabertas >= 1, 'task.reaberta gravada pelo mod');
  });

  test('modelo insiste: repete o Agent depois do deny, a reabertura não passa do que está em voo', async () => {
    const r = await rodar({ plano: planos('tres'), vereditos: { T1: ['REPROVADO'] }, repete: true });
    conferir(r, { fim: 'concluir', pouso: 2, integradas: 3, vereditos: 4, correcoes: 1, proxima: 'concluir' });
    assert.ok(r.denies >= 4, 'houve insistência: 2 negações por pouso');
  });

  test('modelo para após o hand-back: o Stop bloqueia (sem turn.complete) e o loop chega a concluir', async () => {
    const r = await rodar({ plano: planos('tres'), vereditos: { T1: ['REPROVADO'] }, paraAposHandback: true });
    conferir(r, { fim: 'concluir', pouso: 2, integradas: 3, vereditos: 4, correcoes: 1, proxima: 'concluir' });
    assert.ok(r.blocks >= 1, 'o Stop real bloqueou o fim de turno');
  });

  test('teto: T1 reprovada duas vezes para em teto_rodadas', async () => {
    const r = await rodar({ plano: planos('duas'), vereditos: { T1: ['REPROVADO', 'REPROVADO'] } });
    conferir(r, { fim: 'parar teto_rodadas T1', pouso: 1, integradas: 1, vereditos: 3, correcoes: 1, parar: ['teto_rodadas'], proxima: 'parar' });
    assert.equal(r.reabertas, 1, 'a negação com revisor vivo reabre só a correção, e só quando os vivos chegam a 0 (T19 r3); a 2ª reprovação para no teto antes de qualquer despacho novo');
  });

  test('X não atingido: contexto abaixo de X, nenhum Agent negado, nenhum pouso, e o loop conclui', async () => {
    const r = await rodar({ plano: planos('tres'), vereditos: { T1: ['REPROVADO'] }, percent: 10, x: '50' });
    conferir(r, { fim: 'concluir', pouso: 0, integradas: 3, vereditos: 4, correcoes: 1, proxima: 'concluir', denies: 0 });
    assert.equal(r.clears, 0);
  });

  // Regra da T19 r3 (com vivos > 0 o mod não reabre; revisor por último; despacho aceito depois da negação vai atrás; negação sobrevive a Esc e /clear).

  test('lote misto: correção negada e revisor aceito na mesma mensagem; só a negada é reaberta, depois que o revisor termina (achado 1)', async () => {
    const r = await rodar({ plano: planos('duas'), vereditos: { T1: ['REPROVADO'] }, juntos: 2, lote: true });
    conferir(r, { fim: 'concluir', pouso: 1, integradas: 2, vereditos: 3, correcoes: 1, proxima: 'concluir' });
    assert.deepEqual(r.reabertasDe, ['T1'], `T2 (revisor vivo) nunca é reaberta${TRILHA(r)}`);
  });

  test('Esc e /clear com contexto baixo: a negação fica, a task aceita depois não é reaberta (achado 4)', async () => {
    const r = await rodar({ plano: planos('raiz'), esc: true });
    conferir(r, { fim: 'concluir', pouso: 1, integradas: 3, vereditos: 3, proxima: 'concluir' });
    assert.deepEqual(r.reabertasDe, ['T2'], `só a negada (T2) é reaberta, nunca T3${TRILHA(r)}`);
  });

  test('Esc, /clear e o despacho aceito termina antes do fim do turno (escT3Terminou): reabre a negada (T2), nunca a T3, e o hand-back de T3 conclui', async () => {
    const r = await rodar({ plano: planos('raiz'), esc: true, escTermina: true });
    conferir(r, { fim: 'concluir', pouso: 0, integradas: 3, vereditos: 3, proxima: 'concluir' });
    assert.deepEqual(r.reabertasDe, ['T2'], `só a negada (T2) é reaberta; T3 terminou e é a mais recente, mas veio depois da negação${TRILHA(r)}`);
    assert.ok(r.trilha.some((l) => /loop concluir T3 -> ok/.test(l)), `concluir T3 passa (T3 nunca foi reaberta)${TRILHA(r)}`);
  });

  test('hand-back pendente: o revisor termina antes do fim do turno; a reabertura pega a correção negada, não o revisor', async () => {
    const r = await rodar({ plano: planos('duas'), vereditos: { T1: ['REPROVADO'] }, juntos: 2, lote: true, pendente: true });
    conferir(r, { fim: 'concluir', pouso: 1, integradas: 2, vereditos: 3, correcoes: 1, proxima: 'concluir' });
    assert.ok(r.reabertasDe.every((t) => t === 'T1'), `nunca T2${TRILHA(r)}`);
  });

  test('controle positivo: com tasksDoNegado devolvendo lista vazia o REPROVADO trava em nao_conseguiu', async () => {
    const r = await rodar({ plano: planos('uma'), vereditos: { T1: ['REPROVADO'] }, semReabrir: true });
    const m = TRILHA(r);
    assert.equal(r.pouso, 0, `sem reabrir não há pouso${m}`);
    assert.deepEqual(r.proximaFinal, { tipo: 'parar', motivo: 'nao_conseguiu', task: 'T1' }, `trava em nao_conseguiu${m}`);
    assert.notEqual(r.fim, 'concluir', `não chega a concluir${m}`);
    assert.equal(r.reabertas, 0, `nada reaberto${m}`);
  });
});

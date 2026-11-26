/**
 * Registro de decisões determinístico (GM-13 T11, REQ-REG-1). Puro: sem E/S, sem relógio, sem localidade. Mesmo diário ⇒ mesmo byte.
 *
 * A ordem de tudo é a de `ordenar` do loop (única fonte): a ordem de chegada ENTRE sessões não importa; dentro da sessão o `seq`
 * tem de crescer (senão o diário não se sustenta e lança). Texto vindo do diário passa por `limpa` (controle some, tamanho limitado).
 *
 * CONTRATO DE FALHA. Diário `[]` (ausente) é registro com todas as seções em `- nenhum`. Diário que não ordena, ou evento que o registro
 * lê e que não tem a forma do contrato, LANÇA `Error` (o CLI diz `diario_ilegivel`): nunca vira registro "sem aquela decisão".
 */
import { fecharJulgamentos, pontaDaSpec, shaAceito } from './emenda.ts';
import { formaInvalida } from './formas.ts';
import { ordenar } from './loop.ts';
import type { Evento } from './tipos.ts';

const CONTROLE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
const TEXTO_MAX = 240;
const SESSAO_EMENDAS = 'emendas';
const NENHUM = '- nenhum';

type Obj = Record<string, unknown>;
const ehObjeto = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const campo = (o: unknown, k: string): unknown => (ehObjeto(o) && Object.hasOwn(o, k) ? o[k] : undefined);

/**
 * Todo texto do diário que o registro escreve passa por aqui, números inclusive. Controle vira espaço, espaços se juntam, corte por ponto de
 * código com `…`. Nunca devolve quebra de linha. O canário de segredo NÃO fica aqui: roda antes, sobre o texto inteiro (CLI), nunca sobre o já cortado.
 */
function limpa(valor: unknown, max = TEXTO_MAX): string {
  const t = String(valor ?? '').replace(CONTROLE, ' ').replace(/ {2,}/g, ' ').trim();
  const cps = [...t];
  return cps.length > max ? `${cps.slice(0, max).join('')}…` : t;
}

const ref = (e: Evento): string => `${limpa(e.sessao, 128)}:${limpa(e.seq, 16)}`;
const refDe = (r: unknown): string => `${limpa(campo(r, 'sessao'), 128)}:${limpa(campo(r, 'seq'), 16)}`;

function exigirValido(e: Evento): void {
  const motivo = formaInvalida(e.tipo, e.dados);
  if (motivo !== null) throw new Error(`evento ${ref(e)} (${limpa(e.tipo, 64)}) não tem a forma do contrato (${limpa(motivo)}); o registro não omite decisão calado`);
}

const secao = (titulo: string, linhas: string[]): string => `## ${titulo}\n\n${linhas.length === 0 ? NENHUM : linhas.join('\n')}\n`;

export function montarRegistro(entrega: string, eventos: Evento[], specSha: string | null): string {
  if (!Array.isArray(eventos)) throw new Error('diário não é uma lista de eventos');
  for (const e of eventos) {
    if (!ehObjeto(e) || typeof e.sessao !== 'string' || !Number.isInteger(e.seq) || typeof e.tipo !== 'string') throw new Error('diário com evento fora da forma (sessao, seq, tipo)');
  }
  // A ordem final é a de `ordenar` (a chegada entre sessões não importa); `seq` que não cresce DENTRO da sessão é diário corrompido e lança.
  const ord = ordenar(eventos);
  if (!ord.ok) throw new Error('diário fora de ordem (seq que não cresce na sessão, ts ou sessao ilegível)');
  const lista = ord.eventos;

  // 1. Aprovação da spec
  const aprovacoes = lista.filter((e) => e.tipo === 'spec.aprovada');
  aprovacoes.forEach(exigirValido);
  const linhasSpec = aprovacoes.map((e) => `- ${ref(e)} · spec ${limpa(campo(e.dados, 'spec'), 200)} · sha256 ${limpa(campo(e.dados, 'sha256'), 64)}`);
  // T54 (emenda 54): cada emenda aplicada no texto aparece (para o revisor da entrega conferir o diff contra a emenda) e o sha atual confere com a CADEIA.
  const aplicadas = lista.filter((e) => e.tipo === 'spec.aplicada');
  aplicadas.forEach(exigirValido);
  linhasSpec.push(...aplicadas.map((e) => `- ${ref(e)} · emenda #${limpa(campo(e.dados, 'seq'), 16)} ${campo(e.dados, 'reverte') === true ? 'desfeita (texto da emenda revertida pelo dono)' : 'aplicada'} · spec ${limpa(campo(e.dados, 'spec'), 200)} · sha256 ${limpa(campo(e.dados, 'sha256_antes'), 64)} ⇒ ${limpa(campo(e.dados, 'sha256_depois'), 64)}`));
  if (aprovacoes.length > 0) {
    const { ponta } = pontaDaSpec(lista);
    const n = ponta === null ? 0 : ponta.aplicadas;
    const confere = shaAceito(lista, specSha) ? (n === 0 ? 'confere com a última aprovação' : `confere com a aprovação + ${n} ${n === 1 ? 'emenda aplicada' : 'emendas aplicadas'}`) : 'difere da última aprovação';
    linhasSpec.push(specSha === null ? '- sha256 atual da spec: indisponível' : `- sha256 atual da spec: ${limpa(specSha, 64)} (${confere})`);
  }

  // 2. Decisões da Sombra
  const decisoes = lista.filter((e) => e.tipo === 'decisao.sombra');
  decisoes.forEach(exigirValido);
  const linhasSombra = decisoes.map((e) => {
    const d = e.dados;
    const ancora = campo(d, 'req') !== undefined ? limpa(campo(d, 'req'), 64) : `task ${limpa(campo(d, 'task'), 64)}`;
    const fontes = campo(d, 'fontes');
    const partes = [`- ${ref(e)} · ${ancora} · ${limpa(campo(d, 'resposta'))}`];
    if (Array.isArray(fontes)) partes.push(`fontes: ${fontes.map((f) => limpa(f, 200)).join(', ')}`);
    if (campo(d, 'medicao') !== undefined) partes.push(`medição: ${limpa(campo(d, 'medicao'), 200)}`);
    if (campo(d, 'fora_da_regra') === true) partes.push(`fora da regra (emenda #${limpa(campo(d, 'emenda_seq'), 16)})`);
    const subst = campo(d, 'substitui');
    if (subst !== undefined) partes.push(`substitui ${refDe(subst)}`);
    return partes.join(' · ');
  });

  // 3. Emendas: a proposta e o julgamento que a fecha (`fecharJulgamentos`: a mesma regra da projeção; quem julgou: origem)
  const propostas = lista.filter((e) => e.tipo === 'emenda.proposta' && e.sessao === SESSAO_EMENDAS);
  propostas.forEach(exigirValido);
  const julgamentos = lista.filter((e) => e.tipo === 'spec.emendada' || e.tipo === 'emenda.rejeitada');
  julgamentos.forEach(exigirValido);
  const fechamento = fecharJulgamentos(lista);
  // GM-15 T36 (emenda 25 m.4): emenda aplicada e revertida pelo dono: "texto ainda na spec" até o desfazer (`spec.aplicada` com `reverte`), depois "texto desfeito"
  const pontas = pontaDaSpec(lista);
  const desfeita = (seq: number): boolean => pontas.aplicacoes.some((a) => a.seq === seq && a.reverte === true);
  const aplicada = (seq: number): boolean => pontas.aplicacoes.some((a) => a.seq === seq && a.reverte !== true);
  const linhasEmendas: string[] = [];
  for (const p of propostas) {
    const j = fechamento.get(p.seq);
    let estado = j === undefined ? 'aberta' : `${j.aprova ? 'aprovada' : 'rejeitada'} por ${limpa(j.origem, 16)}`;
    if (j !== undefined && !j.aprova && j.origem === 'dono' && aplicada(p.seq)) estado = desfeita(p.seq) ? 'revertida pelo dono; texto desfeito na spec' : 'revertida pelo dono; texto ainda na spec';
    const task = campo(p.dados, 'task') !== undefined ? ` · task ${limpa(campo(p.dados, 'task'), 64)}` : '';
    linhasEmendas.push(`- #${limpa(p.seq, 16)} · ${limpa(campo(p.dados, 'req'), 64)}${task} · ${limpa(campo(p.dados, 'causa'), 32)} · ${estado} · fato: ${limpa(campo(p.dados, 'fato'))} · diff: ${limpa(campo(p.dados, 'diff'))}`);
  }
  for (const [seq, j] of fechamento) {
    if (!propostas.some((p) => p.seq === seq)) linhasEmendas.push(`- #${limpa(seq, 16)} · julgamento sem proposta no diário · ${j.aprova ? 'aprovada' : 'rejeitada'} por ${limpa(j.origem, 16)}`);
  }

  // 4. Liberações de teto: `task.reaberta` com origem `dono` ou `sombra` (GM-14 T36, FIEL-15 c); a retomada não libera teto
  const reabertas = lista.filter((e) => e.tipo === 'task.reaberta' && (campo(e.dados, 'origem') === 'dono' || campo(e.dados, 'origem') === 'sombra'));
  const linhasTeto = reabertas.map((e) => {
    const task = campo(e.dados, 'task');
    if (typeof task !== 'string' || task === '') throw new Error(`evento ${ref(e)} (task.reaberta) sem \`task\`; o registro não omite liberação calado`);
    if (campo(e.dados, 'origem') === 'dono') return `- ${ref(e)} · task ${limpa(task, 64)} · liberada pelo dono`;
    exigirValido(e); // a da Sombra cita a decisão: sem `hash` válido não vira linha "liberada" calada
    return `- ${ref(e)} · task ${limpa(task, 64)} · a Sombra liberou a ${limpa(task, 64)} · decisão ${limpa(campo(e.dados, 'hash'), 64).slice(0, 12)}`;
  });

  // 5. Desvios e 6. Descobertas
  // GM-20 REQ-EXE-3: o `task.iniciada` com `executor` (a task que o orquestrador executou) é desvio visível na review; mesma seção, na ordem do diário
  const executadaPeloOrquestrador = (e: Evento): boolean => e.tipo === 'task.iniciada' && ehObjeto(e.dados) && Object.hasOwn(e.dados, 'executor');
  const desvios = lista.filter((e) => e.tipo === 'desvio' || executadaPeloOrquestrador(e));
  desvios.forEach(exigirValido);
  const linhasDesvios = desvios.map((e) => {
    if (e.tipo === 'task.iniciada') return `- ${ref(e)} · ${limpa(campo(e.dados, 'task'), 64)} executada pelo orquestrador: ${limpa(campo(e.dados, 'motivo'))}`;
    const arq = campo(e.dados, 'arquivos');
    const arquivos = Array.isArray(arq) && arq.length > 0 ? ` · arquivos: ${arq.map((a) => limpa(a, 200)).join(', ')}` : '';
    return `- ${ref(e)} · task ${limpa(campo(e.dados, 'task'), 64)} · ${limpa(campo(e.dados, 'req'), 64)} · ${limpa(campo(e.dados, 'causa'), 32)} · ${limpa(campo(e.dados, 'evidencia'))}${arquivos}`;
  });
  const descobertas = lista.filter((e) => e.tipo === 'descoberta');
  descobertas.forEach(exigirValido);
  const linhasDescobertas = descobertas.map((e) => `- ${ref(e)} · ${limpa(campo(e.dados, 'causa'), 32)} · ${limpa(campo(e.dados, 'evidencia'))}`);

  // 7. e 8. Aprendizados D e M (todos os de forma válida; o substituído fica, marcado)
  const aprendizados = lista.filter((e) => e.tipo === 'aprendizado');
  aprendizados.forEach(exigirValido);
  const linhaAprendizado = (e: Evento): string => {
    const d = e.dados;
    const ev = campo(d, 'evidencia');
    const eventosEv = campo(ev, 'eventos');
    const med = campo(ev, 'medicao');
    const partes = [`- ${ref(e)} · ${limpa(campo(d, 'tipo'), 1)} · ${limpa(campo(d, 'regra'))}`, `entra em: ${(campo(d, 'entra_em') as unknown[]).map((x) => limpa(x, 64)).join(', ')}`];
    if (ehObjeto(med)) partes.push(`fonte: ${limpa(campo(med, 'fonte'), 200)} · número: ${limpa(campo(med, 'numero'), 64)}`);
    else partes.push('sem medição');
    if (Array.isArray(eventosEv)) partes.push(`eventos: ${eventosEv.map(refDe).join(', ')}`);
    const g = campo(d, 'gatilho');
    if (ehObjeto(g)) partes.push(`gatilho: ${refDe(g)}`);
    const s = campo(d, 'substitui');
    if (ehObjeto(s)) partes.push(`substitui ${campo(s, 'entrega') !== undefined ? `${limpa(campo(s, 'entrega'), 32)}/` : ''}${refDe(s)}`);
    return partes.join(' · ');
  };
  const linhasD = aprendizados.filter((e) => campo(e.dados, 'status') === 'D').map(linhaAprendizado);
  const linhasM = aprendizados.filter((e) => campo(e.dados, 'status') === 'M').map(linhaAprendizado);

  return [
    `# Registro de decisões — ${limpa(entrega, 64)}\n`,
    secao('Aprovação da spec', linhasSpec),
    secao('Decisões da Sombra', linhasSombra),
    secao('Emendas', linhasEmendas),
    secao('Liberações de teto', linhasTeto),
    secao('Desvios', linhasDesvios),
    secao('Descobertas', linhasDescobertas),
    secao('Aprendizados D', linhasD),
    secao('Aprendizados M', linhasM),
  ].join('\n');
}

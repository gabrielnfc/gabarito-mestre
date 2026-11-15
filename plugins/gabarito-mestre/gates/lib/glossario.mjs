/**
 * Texto do onboarding para quem nunca programou (GM-14 T7, REQ-ONB-2): glossário fechado, lista proibida e prévia simples.
 * Puro: sem I/O, sem relógio. O que o dono lê sai daqui ou de `perguntas()`; a prévia técnica (`previa`) continua à parte
 * e só aparece quando o dono pede "mostrar detalhes".
 */

/** Termos que podem aparecer nas perguntas; a 1ª ocorrência (por conversa) leva a explicação entre parênteses. */
export const GLOSSARIO = Object.freeze([
  { termo: 'pedido de revisão', explicacao: 'proposta para você conferir' },
  { termo: 'testes', explicacao: 'checagens automáticas' },
  { termo: 'publicar', explicacao: 'colocar no ar para as pessoas usarem' },
].map((g) => Object.freeze(g)));

const METODOS_DE_ENSINO = ['feynman', 'socrático', 'socratico', 'eli5', 'scaffolding', 'andaime', 'analogia', 'microlearning', 'gamificação'];

/** Palavras que o dono nunca lê: jargão do repositório, regra por número, arquivo de configuração, flag, nome de método de ensino e "leigo". */
export const PROIBIDOS = Object.freeze(['branch', 'merge', 'deploy', 'PR', 'CI', 'commit', 'hook', 'spec', 'token', /R\d+/, '.json', '--', ...METODOS_DE_ENSINO, 'leigo']);

const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FRONTEIRA_ANTES = '(?<![\\p{L}\\p{N}_])';
const FRONTEIRA_DEPOIS = '(?![\\p{L}\\p{N}_])';
/** Palavra inteira (plural com "s" vale), sem pegar pedaço de outra palavra. `PR` e `CI` só em maiúsculas; `.json` e `--` casam em qualquer lugar. */
function regexDoProibido(termo) {
  if (termo instanceof RegExp) return termo;
  if (termo === '.json' || termo === '--') return new RegExp(escapar(termo), 'iu');
  return new RegExp(`${FRONTEIRA_ANTES}${escapar(termo)}s?${FRONTEIRA_DEPOIS}`, termo === 'PR' || termo === 'CI' ? 'u' : 'iu');
}
const nomeDoProibido = (t) => (t instanceof RegExp ? t.source : t);

/** Proibidos que o texto contém, na ordem em que aparecem. */
export function acharProibidos(texto) {
  const achados = [];
  for (const t of PROIBIDOS) {
    const m = regexDoProibido(t).exec(String(texto ?? ''));
    if (m) achados.push({ nome: nomeDoProibido(t), pos: m.index });
  }
  return achados.sort((a, b) => a.pos - b.pos).map((a) => a.nome);
}

const regexDoTermo = (termo) => new RegExp(`${FRONTEIRA_ANTES}${escapar(termo)}${FRONTEIRA_DEPOIS}`, 'iu');

/**
 * A 1ª ocorrência de cada termo do glossário ainda não visto ganha ` (explicação)`; as seguintes ficam como estão.
 * `vistos` (conjunto de termos em caixa baixa) é atualizado: passe o mesmo conjunto por toda a conversa.
 */
export function explicarPrimeira(texto, vistos) {
  const base = String(texto);
  const inserir = [];
  for (const g of GLOSSARIO) {
    const chave = g.termo.toLowerCase();
    if (vistos.has(chave)) continue;
    const m = regexDoTermo(g.termo).exec(base);
    if (!m) continue;
    vistos.add(chave);
    inserir.push({ fim: m.index + m[0].length, texto: ` (${g.explicacao})` });
  }
  // de trás para a frente, para o índice das outras inserções não andar
  return inserir.sort((a, b) => b.fim - a.fim).reduce((t, i) => t.slice(0, i.fim) + i.texto + t.slice(i.fim), base);
}

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const NAO_SEI = { tipo_repo: 'se há um aplicativo ou site', ambientes: 'qual versão as pessoas usam', planejamento: 'onde as tarefas são anotadas', versionamento: 'onde as mudanças aprovadas se juntam', orquestracao: 'quantas frentes a IA pode tocar ao mesmo tempo' };

/** Uma frase para um fato detectado, ou `null` quando o valor não tem a forma esperada (aí a frase de "em aberto" vale). */
function fraseDetectada(item, valor) {
  if (item === 'tipo_repo' && valor === 'app') return 'Tem um aplicativo ou site que as pessoas usam.';
  if (item === 'tipo_repo' && valor === 'repo-sem-app') return 'Não tem aplicativo nem site: é só código de apoio ou documentos.';
  if (item === 'ambientes' && ehObjeto(valor) && typeof valor.producao === 'string') {
    const outros = Array.isArray(valor.outros) ? valor.outros.filter((o) => typeof o === 'string') : [];
    return `A versão que as pessoas usam chama-se ${valor.producao}${outros.length > 0 ? ` (há também: ${outros.join(', ')})` : ''}.`;
  }
  if (item === 'planejamento' && ehObjeto(valor) && typeof valor.ferramenta === 'string') {
    return valor.ferramenta === 'arquivos' ? 'As tarefas ficam em arquivos dentro do próprio projeto.' : `As tarefas são anotadas em ${valor.ferramenta}.`;
  }
  if (item === 'versionamento' && typeof valor === 'string') return `As mudanças aprovadas se juntam na linha "${valor}".`;
  if (item === 'orquestracao' && ehObjeto(valor) && Number.isInteger(valor.simultaneos) && Number.isInteger(valor.teto)) {
    return `A IA trabalha em ${valor.simultaneos} frentes ao mesmo tempo (no máximo ${valor.teto}).`;
  }
  return null;
}

/**
 * Prévia para quem nunca programou: abre com "a oficina onde o projeto mora", 1 frase por fato (sem fonte nem estado técnico),
 * quantas perguntas vêm e como pedir os detalhes. Fato aberto: "vou perguntar" só se há pergunta para ele em `perguntas`;
 * senão diz que fica em aberto (nunca escolhe pelo dono). Não usa termo do glossário: a explicação vem nas perguntas.
 */
export function previaSimples(itens, perguntas) {
  const comPergunta = new Set((perguntas ?? []).map((p) => p.id));
  const linhas = ['A oficina onde o projeto mora: olhei por dentro e achei isto.'];
  for (const i of itens ?? []) {
    const f = i.estado === 'detectado' ? fraseDetectada(i.item, i.valor) : null;
    if (f !== null) linhas.push(`- ${f}`);
    else if (!Object.hasOwn(NAO_SEI, i.item)) linhas.push('- Há mais um ponto do projeto que eu olhei.');
    else linhas.push(`- Não deu para saber ${NAO_SEI[i.item]}; ${comPergunta.has(i.item) ? 'vou perguntar' : 'deixo em aberto por enquanto'}.`);
  }
  const n = (perguntas ?? []).length;
  linhas.push('', `Agora ${n} ${n === 1 ? 'pergunta rápida' : 'perguntas rápidas'} sobre como a IA deve trabalhar aqui; apertar Enter aceita a primeira opção, que já é a sugestão.`, 'Para ver os detalhes técnicos, peça "mostrar detalhes".');
  return linhas.join('\n');
}

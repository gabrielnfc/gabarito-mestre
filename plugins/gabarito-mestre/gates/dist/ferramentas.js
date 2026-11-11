/**
 * Linha de ferramenta em linguagem natural (GM-14, REQ-CHT-1). Núcleo puro, sem I/O: o mod (`mod/chat.mjs`) lê o `ToolGroup`, monta as
 * `Chamada`s e desenha o texto daqui; `null` ⇒ o mod devolve `next(e)` (o motor desenha o grupo). Nunca lança.
 *
 * Tabela fechada, nome EXATO (sem caixa): leitura/busca `Read`, `Grep`, `Glob`; edição `Edit`, `Write`, `NotebookEdit`; shell `Bash`; `Agent`.
 * Qualquer outro nome, qualquer chamada com erro ou entrada fora da forma derruba o grupo inteiro para `null`: a linha nunca diz menos que o fato.
 * Limite declarado (S2b, t0a.md): chamada solo chega como grupo de 1 e só `Read` solo foi medido; Bash, Edit e Agent solo são presumidos.
 */
                                                                      

const LEITURA = new Set(['Read', 'Grep', 'Glob']);
const EDICAO = new Set(['Edit', 'Write', 'NotebookEdit']);
const MAX_PAPEL = 60;

const plural = (n        , um        , varios        )         => `${n} ${n === 1 ? um : varios}`;

/** Papel do agente para a linha: sem caractere de controle, aparado, até 60 caracteres. Vazio ⇒ `null`. */
function papelLimpo(p         )                {
  if (typeof p !== 'string') return null;
  const t = [...p.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()].slice(0, MAX_PAPEL).join('').trim();
  return t === '' ? null : t;
}

/** 1 linha para o grupo de chamadas; `null` ⇒ o mod devolve `next(e)`. */
export function linhaDoGrupo(cs           )                {
  try {
    if (!Array.isArray(cs) || cs.length === 0) return null;
    let leitura = 0;
    let edicao = 0;
    let shell = 0;
    const agentes           = [];
    for (const x of cs) {
      if (x === null || typeof x !== 'object' || typeof x.nome !== 'string' || x.erro !== false) return null;
      if (LEITURA.has(x.nome)) leitura += 1;
      else if (EDICAO.has(x.nome)) edicao += 1;
      else if (x.nome === 'Bash') shell += 1;
      else if (x.nome === 'Agent') agentes.push(`chamou ${papelLimpo(x.papel) ?? 'um agente'}`);
      else return null;
    }
    const partes           = [];
    if (leitura > 0) partes.push(`consultou ${plural(leitura, 'arquivo', 'arquivos')}`);
    if (edicao > 0) partes.push(`alterou ${plural(edicao, 'arquivo', 'arquivos')}`);
    if (shell > 0) partes.push(`executou ${plural(shell, 'comando', 'comandos')}`);
    partes.push(...agentes);
    return partes.join(', ');
  } catch {
    return null;
  }
}

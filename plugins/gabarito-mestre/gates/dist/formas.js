/**
 * Forma de `dados` por tipo de evento do diário (GM-11 T1, REQ-SOM-2, EME-1, ENT-2). Núcleo puro e total: `formaInvalida` nunca lança,
 * qualquer `dados` (null, array, texto, número, objeto com `__proto__`, getter que lança) vira motivo, nunca exceção.
 *
 * Contrato de falha: `dados` ausente (`undefined`) e `dados` corrompido (qualquer valor que não seja objeto simples) têm motivos distintos;
 * campo obrigatório ausente e campo inválido também. Só vale propriedade própria: o que vem do prototype não conta (D1).
 * `null` = forma ok ou tipo sem regra. Tipos da E1/E2 não ganham regra nova, salvo os campos opcionais de `ci.resultado`,
 * `custo.medicao` e (E4) `task.iniciada.modelo` e `task.integrada.mutacoes`; para eles, `dados` que não é objeto segue aceito (é o que o diário aceita hoje: nenhum evento existente passa a ser recusado).
 */

                                                                 

/** Lista runtime da união `TipoEvento` (GM-14): o teste `tipos-evento-cobre-a-uniao` confere contra o fonte de `tipos.ts`. */
export const TIPOS_EVENTO                        = Object.freeze([
  'producao.acesso', 'operacao.destrutiva', 'guarda.deny', 'guarda.ask', 'sessao.inicio', 'guarda.heartbeat', 'diario.recusa',
  'task.iniciada', 'task.concluida', 'review.veredito', 'task.integrada', 'task.reaberta', 'ci.resultado', 'loop.parar', 'loop.pausa',
  'custo.medicao', 'sessao.pouso', 'sessao.retomada',
  'sombra.consulta', 'decisao.sombra', 'desvio', 'descoberta', 'emenda.proposta', 'spec.emendada', 'emenda.rejeitada',
  'entrega.inicio', 'entrega.smoke', 'entrega.rollback', 'entrega.fim', 'entrega.agendada',
  'spec.aprovada', 'entrega.devolvida',
  'aprendizado', 'aprendizado.nada', 'dono.mensagem',
  'fato.medido', 'nota', 'dono.resposta',
]                                         );

/** Lista runtime da união `MotivoParar` (GM-14), conferida do mesmo jeito. */
export const MOTIVOS_PARAR                         = Object.freeze([
  'teto_rodadas', 'ci_vermelho', 'teto_tokens', 'sem_pouso', 'sem_progresso', 'diario_invalido', 'nao_conseguiu', 'smoke', 'rollback', 'janela_ausente',
]                                          );

/**
 * `IdPergunta` (GM-14): `<sessao>:<seq>` (sessão `[A-Za-z0-9-]{1,128}`, seq ≥ 1) ou `herdar:<id>`, com o id ESTÁVEL do candidato herdado em hex
 * minúsculo 8..64 (DP-6: derivado de origem + sha256 do trecho; índice de lista não serve). A sessão `herdar` não entra na 1ª forma.
 */
export const ID_PERGUNTA_RE         = /^(?:(?!herdar:)[A-Za-z0-9-]{1,128}:[1-9]\d{0,14}|herdar:[0-9a-f]{8,64})$/;

/** `REQ-<ÁREA>-<n>`, padrão inteiro (âncoras): `REQ-A-1x` e minúscula não casam. */
export const REQ_RE         = /^REQ-[A-Z0-9]+-\d+$/;

const HASH_RE = /^[0-9a-f]{64}$/;
const TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const CAUSAS                    = ['regra_negocio', 'tecnica'];
const ORIGENS                    = ['dono', 'sombra'];
const POLITICAS                    = ['continua', 'janela', 'sob_demanda'];
const MOTIVOS_FIM                    = ['deploy', 'smoke', 'rollback'];
const RESPOSTA_MAX = 1000;
const MOTIVO_DEVOLVIDA_MAX = 200;
const MODELOS_TASK                    = ['haiku', 'sonnet', 'opus', 'fable'];
/** Papéis de task do loop (fonte única: `loop.ts` reexporta; aqui porque `loop.ts` já importa `formas.ts` via `emenda.ts`). */
export const PAPEIS                   = ['implementador', 'revisor', 'correcao'];
const SESSAO_RE = /^[A-Za-z0-9._-]{1,128}$/;
/** Mesmo padrão de `ENTREGA_RE` em `scripts/loop.mjs`: chave de mapa, nunca caminho. */
const ENTREGA_RE = /^[A-Z]+-\d+$/;
const REGRA_MAX = 300;
const DESTINOS_FIXOS                    = ['instantaneo', 'spec'];
const EVENTO_FONTE_RE = /^evento:([A-Za-z0-9._-]{1,128}):([1-9]\d*)$/;
const NOTA_MAX = 160;
const OPCAO_MAX = 60;
const TIPOS_NOTA                    = ['ideia', 'desvio', 'assunto', 'duvida', 'pendencia'];
const FONTES_FATO                    = ['git', 'gh', 'arquivo', 'mod'];
const ESTADOS_PR                    = ['aberto', 'mergeado', 'fechado'];
const CONFIRMACAO_FONTE_RE = /^(.+):([1-9]\d{0,8})$/;

                                   
const ehObjeto = (v         )           => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Só propriedade própria; `undefined` explícito vale como ausente. */
const campo = (o     , k        )          => (Object.hasOwn(o, k) ? o[k] : undefined);
const texto = (v         )              => typeof v === 'string' && v.trim() !== '';
const inteiroPositivo = (v         )              => typeof v === 'number' && Number.isInteger(v) && v >= 1;

/** Cada regra devolve o motivo (citando o campo) ou `null`. */
                                       

const obrigatorio = (nome        )         => `campo \`${nome}\` ausente`;

/** Texto não vazio (obrigatório). */
function exigirTexto(o     , nome        )                {
  const v = campo(o, nome);
  if (v === undefined) return obrigatorio(nome);
  return texto(v) ? null : `campo \`${nome}\` inválido: esperado texto não vazio`;
}

/** Texto não vazio (opcional). */
function opcionalTexto(o     , nome        )                {
  const v = campo(o, nome);
  if (v === undefined) return null;
  return texto(v) ? null : `campo \`${nome}\` inválido: esperado texto não vazio`;
}

function exigirReq(o     , nome = 'req')                {
  const v = campo(o, nome);
  if (v === undefined) return obrigatorio(nome);
  return typeof v === 'string' && REQ_RE.test(v) ? null : `campo \`${nome}\` inválido: ${JSON.stringify(v)} não casa REQ-<ÁREA>-<n>`;
}

function exigirEnum(o     , nome        , valores                   )                {
  const v = campo(o, nome);
  if (v === undefined) return obrigatorio(nome);
  return typeof v === 'string' && valores.includes(v) ? null : `campo \`${nome}\` inválido: esperado um de ${valores.join(' | ')}`;
}

function exigirBooleano(o     , nome        )                {
  const v = campo(o, nome);
  if (v === undefined) return obrigatorio(nome);
  return typeof v === 'boolean' ? null : `campo \`${nome}\` inválido: esperado booleano`;
}

function exigirHash(o     )                {
  const v = campo(o, 'pergunta_hash');
  if (v === undefined) return obrigatorio('pergunta_hash');
  return typeof v === 'string' && HASH_RE.test(v) ? null : 'campo `pergunta_hash` inválido: esperado sha256 em hex minúsculo (64)';
}

function exigirReqOuTask(o     )                {
  const req = campo(o, 'req');
  const task = campo(o, 'task');
  if (req !== undefined && task !== undefined) return 'campos `req` e `task` juntos: exatamente um dos dois';
  if (req === undefined && task === undefined) return 'campo `req` ou `task` ausente: exatamente um dos dois';
  return req !== undefined ? exigirReq(o) : exigirTexto(o, 'task');
}

function listaDeTextos(o     , nome        , { vazia }                    )                {
  const v = campo(o, nome);
  if (v === undefined) return obrigatorio(nome);
  if (!Array.isArray(v)) return `campo \`${nome}\` inválido: esperado lista de textos`;
  if (!vazia && v.length === 0) return `campo \`${nome}\` inválido: lista vazia`;
  return v.every(texto) ? null : `campo \`${nome}\` inválido: todo item deve ser texto não vazio`;
}

const inteiroPos = (o     , nome        )                => {
  const v = campo(o, nome);
  if (v === undefined) return obrigatorio(nome);
  return inteiroPositivo(v) ? null : `campo \`${nome}\` inválido: esperado inteiro ≥ 1`;
};

function exigirSha256(o     )                {
  const v = campo(o, 'sha256');
  if (v === undefined) return obrigatorio('sha256');
  return typeof v === 'string' && HASH_RE.test(v) ? null : 'campo `sha256` inválido: esperado sha256 em hex minúsculo (64)';
}

function motivoDevolvida(o     )                {
  const v = campo(o, 'motivo');
  if (v === undefined) return obrigatorio('motivo');
  if (typeof v !== 'string' || v.trim() === '') return 'campo `motivo` inválido: esperado texto não vazio';
  const n = [...v].length;
  return n > MOTIVO_DEVOLVIDA_MAX ? `campo \`motivo\` inválido: ${n} caracteres, máximo ${MOTIVO_DEVOLVIDA_MAX}` : null;
}

/** Ordem de checagem estável: o 1º defeito é o motivo. */
const primeiro = (...rs                   )                => rs.find((r) => r !== null) ?? null;

const decisaoSombra        = (o) => {
  const resposta = campo(o, 'resposta');
  let respostaErro               ;
  if (resposta === undefined) respostaErro = obrigatorio('resposta');
  else if (typeof resposta !== 'string') respostaErro = 'campo `resposta` inválido: esperado texto';
  else {
    const n = [...resposta].length;
    respostaErro = resposta.trim() === '' ? 'campo `resposta` inválido: vazia' : n > RESPOSTA_MAX ? `campo \`resposta\` inválido: ${n} caracteres, máximo ${RESPOSTA_MAX}` : null;
  }
  const subst = campo(o, 'substitui');
  let substErro                = null;
  if (subst !== undefined) {
    substErro = ehObjeto(subst) && texto(campo(subst, 'sessao')) && inteiroPositivo(campo(subst, 'seq'))
      ? null
      : 'campo `substitui` inválido: esperado {sessao: texto, seq: inteiro ≥ 1}';
  }
  const fora = campo(o, 'fora_da_regra');
  const foraErro = fora === undefined || fora === true ? null : 'campo `fora_da_regra` inválido: só `true` ou ausente';
  const emenda = campo(o, 'emenda_seq');
  const emendaErro = emenda === undefined ? null : inteiroPositivo(emenda) ? null : 'campo `emenda_seq` inválido: esperado inteiro ≥ 1';
  const fontes = campo(o, 'fontes');
  const medicao = campo(o, 'medicao');
  const fontesErro = fontes === undefined ? null : listaDeTextos(o, 'fontes', { vazia: false });
  const medicaoErro = medicao === undefined ? null : texto(medicao) ? null : 'campo `medicao` inválido: esperado texto não vazio';
  const base = primeiro(
    exigirHash(o), exigirReqOuTask(o), respostaErro, exigirTexto(o, 'arquivo'), exigirBooleano(o, 'pergunta_enviesada'),
    fontesErro, medicaoErro, substErro, foraErro, emendaErro,
  );
  if (base !== null) return base;
  if (fora === true) return emenda === undefined ? 'campo `emenda_seq` ausente: `fora_da_regra` exige a emenda que o cobre' : null;
  return fontes === undefined && medicao === undefined ? 'campo `fontes` ou `medicao` ausente: decisão sem fonte nem medição' : null;
};

function quando(o     )                {
  const v = campo(o, 'quando');
  if (v === undefined) return obrigatorio('quando');
  const m = typeof v === 'string' ? TS_RE.exec(v) : null;
  const invalido = 'campo `quando` inválido: esperado instante ISO 8601 com fuso';
  if (m === null) return invalido;
  const [ano, mes, dia, h, mi, s] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i]));
  const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  if (mes < 1 || mes > 12 || dia < 1 || dia > diasNoMes || h > 23 || mi > 59 || s > 59) return invalido;
  return Number.isFinite(Date.parse(v          )) ? null : invalido;
}

// ── E5a (GM-13 T1): aprendizado, aprendizado.nada, dono.mensagem ──────────────────────────────────────────────────────────────

const refEvento = (v         )          => ehObjeto(v) && typeof campo(v, 'sessao') === 'string' && SESSAO_RE.test(campo(v, 'sessao')          ) && inteiroPositivo(campo(v, 'seq'));
const contar = (t        )         => [...t].length;
const temControle = (t        )          => [...t].some((ch) => { const c = ch.codePointAt(0)          ; return c < 0x20 || c === 0x7f; });

/** Caminho relativo que fica na árvore: sem `..`, nunca absoluto, nunca barra invertida nem letra de unidade, sem controle. */
function caminhoRelativo(f         )              {
  if (typeof f !== 'string' || f.trim() === '' || temControle(f)) return false;
  if (f.includes('\\') || /^[A-Za-z]:/.test(f)) return false;
  // `/` inicial, `a//b` e `a/` viram segmento vazio: recusados junto com `..`.
  return f.split('/').every((seg) => seg !== '..' && seg !== '');
}

/** Fonte da medição: caminho relativo sem `..` (nunca absoluto, nunca barra invertida) ou `evento:<sessao>:<seq>`. */
function fonteValida(f         )          {
  if (typeof f === 'string' && f.startsWith('evento:')) return !temControle(f) && EVENTO_FONTE_RE.test(f);
  return caminhoRelativo(f);
}

/** `confirmacao` (GM-14, D11): exatamente `{fonte: '<arquivo relativo>:<linha ≥ 1>', resposta: {sessao, seq}}`. Só forma; o resto é de `validarAprendizado`. */
function confirmacaoInvalida(c         )                {
  if (!ehObjeto(c)) return '`confirmacao` esperado {fonte, resposta}';
  const extra = Object.keys(c).find((k) => k !== 'fonte' && k !== 'resposta');
  if (extra !== undefined) return `\`confirmacao.${extra}\` não permitido: só {fonte, resposta}`;
  const fonte = campo(c, 'fonte');
  const m = typeof fonte === 'string' ? CONFIRMACAO_FONTE_RE.exec(fonte) : null;
  if (m === null || !caminhoRelativo(m[1])) return '`confirmacao.fonte` esperado `<arquivo relativo sem ..>:<linha ≥ 1>`';
  return refEvento(campo(c, 'resposta')) ? null : '`confirmacao.resposta` esperado {sessao: texto da forma de sessão, seq: inteiro ≥ 1}';
}

/** Obrigatório e do tipo `RefEvento`; `permiteNulo` aceita `null` (gatilho do aprendizado sem pendência). */
function exigirRef(o     , nome        , permiteNulo         )                {
  const v = campo(o, nome);
  if (v === undefined) return obrigatorio(nome);
  if (v === null) return permiteNulo ? null : `campo \`${nome}\` inválido: esperado {sessao, seq}, não null`;
  return refEvento(v) ? null : `campo \`${nome}\` inválido: esperado {sessao: texto da forma de sessão, seq: inteiro ≥ 1}`;
}

function exigirRegra(o     , nome        )                {
  const v = campo(o, nome);
  if (v === undefined) return obrigatorio(nome);
  if (typeof v !== 'string' || v.trim() === '') return `campo \`${nome}\` inválido: esperado texto não vazio`;
  const n = contar(v);
  return n > REGRA_MAX ? `campo \`${nome}\` inválido: ${n} caracteres, máximo ${REGRA_MAX}` : null;
}

function evidenciaDoAprendizado(o     )                {
  const v = campo(o, 'evidencia');
  if (v === undefined) return obrigatorio('evidencia');
  const invalida = (m        )         => `campo \`evidencia\` inválido: ${m}`;
  if (!ehObjeto(v)) return invalida('esperado objeto');
  const eventos = campo(v, 'eventos');
  if (eventos !== undefined && (!Array.isArray(eventos) || eventos.length === 0 || !eventos.every(refEvento))) return invalida('`eventos` esperado lista não vazia de {sessao, seq}');
  const medicao = campo(v, 'medicao');
  if (medicao !== undefined) {
    if (!ehObjeto(medicao)) return invalida('`medicao` esperado {fonte, numero}');
    const numero = campo(medicao, 'numero');
    if (typeof numero !== 'number' || !Number.isFinite(numero)) return invalida('`medicao.numero` esperado número finito');
    if (!fonteValida(campo(medicao, 'fonte'))) return invalida('`medicao.fonte` esperado caminho relativo sem `..` ou `evento:<sessao>:<seq>`');
  }
  const confirmacao = campo(v, 'confirmacao');
  if (confirmacao !== undefined) {
    const m = confirmacaoInvalida(confirmacao);
    if (m !== null) return invalida(m);
  }
  return null;
}

function entraEm(o     )                {
  const v = campo(o, 'entra_em');
  if (v === undefined) return obrigatorio('entra_em');
  const invalido = `campo \`entra_em\` inválido: esperado lista não vazia, sem repetição, de ${DESTINOS_FIXOS.join(' | ')} | brief:<${PAPEIS.join('|')}>`;
  if (!Array.isArray(v) || v.length === 0 || new Set(v).size !== v.length) return invalido;
  return v.every((d) => typeof d === 'string' && (DESTINOS_FIXOS.includes(d) || (d.startsWith('brief:') && PAPEIS.includes(d.slice(6)         )))) ? null : invalido;
}

function substituiDoAprendizado(o     )                {
  const v = campo(o, 'substitui');
  if (v === undefined) return null;
  const invalido = 'campo `substitui` inválido: esperado {sessao, seq, entrega?} com entrega da forma <SIGLA>-<n>';
  if (!refEvento(v)) return invalido;
  const entrega = campo(v       , 'entrega');
  return entrega === undefined || (typeof entrega === 'string' && ENTREGA_RE.test(entrega)) ? null : invalido;
}

/** D só com evidência: sem `eventos`, `medicao` nem `confirmacao` (D herdado, GM-14), o motivo manda gravar como M. */
function dSemEvidencia(o     )                {
  if (campo(o, 'status') !== 'D') return null;
  // `primeiro` avalia todos os argumentos: sem a chave (ou com tipo errado) a regra de `evidencia` já recusa; aqui nunca lança.
  const ev = campo(o, 'evidencia');
  if (!ehObjeto(ev)) return null;
  return campo(ev, 'eventos') === undefined && campo(ev, 'medicao') === undefined && campo(ev, 'confirmacao') === undefined
    ? 'status `D` sem evidência da máquina (`eventos` ou `medicao`) nem `confirmacao`: grave como M'
    : null;
}

const aprendizado        = (o) => primeiro(
  exigirEnum(o, 'tipo', ['E', 'A']), exigirEnum(o, 'status', ['D', 'M']), exigirRef(o, 'gatilho', true), evidenciaDoAprendizado(o),
  exigirRegra(o, 'regra'), entraEm(o), substituiDoAprendizado(o), dSemEvidencia(o),
);

const aprendizadoNada        = (o) => primeiro(exigirRef(o, 'gatilho', false), exigirRegra(o, 'motivo'));

/** `dono.mensagem` carrega só o hash e o tamanho: qualquer outra chave (inclusive `texto`) é recusada, para o texto nunca chegar ao diário. */
const donoMensagem        = (o) => {
  const chars = campo(o, 'chars');
  const charsErro = chars === undefined ? obrigatorio('chars') : typeof chars === 'number' && Number.isInteger(chars) && chars >= 0 ? null : 'campo `chars` inválido: esperado inteiro ≥ 0';
  const extra = Object.keys(o).find((k) => k !== 'sha256' && k !== 'chars');
  return primeiro(exigirSha256(o), charsErro, extra === undefined ? null : `campo \`${extra}\` não permitido: \`dono.mensagem\` carrega só {sha256, chars}`);
};

// ── GM-14 T1: fato.medido, nota, dono.resposta ────────────────────────────────────────────────────────────────────────────────

/** Primeira chave fora de `permitidas`, como motivo; `null` se todas pertencem à forma. */
function chaveExtra(o     , permitidas                   , forma        )                {
  const extra = Object.keys(o).find((k) => !permitidas.includes(k));
  return extra === undefined ? null : `campo \`${extra}\` não permitido: ${forma}`;
}

/** Texto de 1 linha (sem controle), não vazio e com no máximo `max` caracteres (por caractere, não byte); sem `max`, só os demais. */
function textoLinha(o     , nome        , max         )                {
  const v = campo(o, nome);
  if (v === undefined) return obrigatorio(nome);
  if (typeof v !== 'string' || v.trim() === '' || temControle(v)) return `campo \`${nome}\` inválido: esperado texto não vazio de 1 linha`;
  const n = contar(v);
  return max !== undefined && n > max ? `campo \`${nome}\` inválido: ${n} caracteres, máximo ${max}` : null;
}

function inteiroNaoNegativo(o     , nome        )                {
  const v = campo(o, nome);
  if (v === undefined) return obrigatorio(nome);
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? null : `campo \`${nome}\` inválido: esperado inteiro ≥ 0`;
}

function exigirCaminho(o     , nome        )                {
  const v = campo(o, nome);
  if (v === undefined) return obrigatorio(nome);
  return caminhoRelativo(v) ? null : `campo \`${nome}\` inválido: esperado caminho relativo sem \`..\``;
}

/** Forma exata do `valor` por `chave`: cada campo com a sua regra; nenhum a mais. */
const FORMAS_FATO                                                                                         = new Map([
  ['branch', { nome: (o, n) => textoLinha(o, n) }],
  ['spec', { caminho: exigirCaminho, sha256: (o) => exigirSha256(o), secoes: inteiroNaoNegativo }],
  ['plano', { tasks: inteiroNaoNegativo }],
  ['pr', { numero: inteiroPos, estado: (o, n) => exigirEnum(o, n, ESTADOS_PR), branch: (o, n) => textoLinha(o, n) }],
  ['release', { tag: (o, n) => textoLinha(o, n) }],
  ['agente', { id: (o, n) => textoLinha(o, n), papel: (o, n) => textoLinha(o, n), estado: (o, n) => textoLinha(o, n) }],
]);

const fatoMedido        = (o) => {
  const base = primeiro(
    chaveExtra(o, ['chave', 'fonte', 'valor'], '`fato.medido` carrega só {chave, fonte, valor}'),
    exigirEnum(o, 'chave', [...FORMAS_FATO.keys()]), exigirEnum(o, 'fonte', FONTES_FATO),
  );
  if (base !== null) return base;
  const valor = campo(o, 'valor');
  if (valor === undefined) return obrigatorio('valor');
  if (!ehObjeto(valor)) return 'campo `valor` inválido: esperado objeto';
  const chave = campo(o, 'chave')          ;
  const forma = FORMAS_FATO.get(chave)                                                                     ;
  const campos = Object.keys(forma);
  const erro = primeiro(chaveExtra(valor, campos, `\`valor\` de \`${chave}\` carrega só {${campos.join(', ')}}`), ...campos.map((k) => forma[k](valor, k)));
  return erro === null ? null : `valor de \`${chave}\`: ${erro}`;
};

function opcoesDaNota(o     )                {
  const v = campo(o, 'opcoes');
  if (campo(o, 'tipo') !== 'duvida') return v === undefined ? null : 'campo `opcoes` não permitido: só `duvida` leva opções';
  if (v === undefined) return obrigatorio('opcoes');
  const invalido = `campo \`opcoes\` inválido: esperado 2 a 4 textos de 1 linha com 1 a ${OPCAO_MAX} caracteres, sem repetição`;
  if (!Array.isArray(v) || v.length < 2 || v.length > 4) return invalido;
  if (!v.every((x) => typeof x === 'string' && x.trim() !== '' && !temControle(x) && contar(x) <= OPCAO_MAX)) return invalido;
  return new Set(v.map((x        ) => x.trim().toLowerCase())).size === v.length ? null : invalido;
}

const nota        = (o) => primeiro(
  chaveExtra(o, ['tipo', 'texto', 'opcoes'], '`nota` carrega só {tipo, texto, opcoes?}'),
  exigirEnum(o, 'tipo', TIPOS_NOTA), textoLinha(o, 'texto', NOTA_MAX), opcoesDaNota(o),
);

/** `dono.resposta`: `{pergunta, opcao, rotulo}` OU `{pergunta, sha256, chars}`; misturar, ou qualquer outra chave (`texto`), recusa. */
const donoResposta        = (o) => {
  const porOpcao = campo(o, 'opcao') !== undefined || campo(o, 'rotulo') !== undefined;
  const porHash = campo(o, 'sha256') !== undefined || campo(o, 'chars') !== undefined;
  if (porOpcao && porHash) return 'formas misturadas: exatamente uma de {pergunta, opcao, rotulo} ou {pergunta, sha256, chars}';
  const pergunta = campo(o, 'pergunta');
  const perguntaErro = pergunta === undefined
    ? obrigatorio('pergunta')
    : typeof pergunta === 'string' && ID_PERGUNTA_RE.test(pergunta) ? null : 'campo `pergunta` inválido: esperado `<sessao>:<seq>` ou `herdar:<id em hex>`';
  if (porHash) {
    return primeiro(chaveExtra(o, ['pergunta', 'sha256', 'chars'], '`dono.resposta` digitada carrega só {pergunta, sha256, chars}'), perguntaErro, exigirSha256(o), inteiroNaoNegativo(o, 'chars'));
  }
  const opcao = campo(o, 'opcao');
  const opcaoErro = opcao === undefined ? obrigatorio('opcao') : typeof opcao === 'number' && Number.isInteger(opcao) && opcao >= 1 && opcao <= 4 ? null : 'campo `opcao` inválido: esperado inteiro de 1 a 4';
  return primeiro(chaveExtra(o, ['pergunta', 'opcao', 'rotulo'], '`dono.resposta` carrega só {pergunta, opcao, rotulo}'), perguntaErro, opcaoErro, textoLinha(o, 'rotulo', OPCAO_MAX));
};

const REGRAS                             = new Map               ([
  ['sombra.consulta', (o) => primeiro(exigirHash(o), exigirReqOuTask(o))],
  ['decisao.sombra', decisaoSombra],
  ['desvio', (o) => primeiro(exigirTexto(o, 'task'), exigirReq(o), exigirTexto(o, 'evidencia'), listaDeTextos(o, 'arquivos', { vazia: true }), exigirEnum(o, 'causa', CAUSAS))],
  ['descoberta', (o) => primeiro(exigirTexto(o, 'evidencia'), exigirEnum(o, 'causa', CAUSAS))],
  [
    'emenda.proposta',
    (o) => {
      const arquivos = campo(o, 'arquivos');
      return primeiro(
        exigirReq(o), opcionalTexto(o, 'task'), exigirTexto(o, 'diff'), exigirTexto(o, 'fato'), exigirTexto(o, 'alternativa'),
        exigirTexto(o, 'evidencia'), exigirEnum(o, 'causa', CAUSAS), arquivos === undefined ? null : listaDeTextos(o, 'arquivos', { vazia: true }),
      );
    },
  ],
  ['spec.emendada', (o) => primeiro(inteiroPos(o, 'proposta_seq'), exigirEnum(o, 'origem', ORIGENS))],
  ['emenda.rejeitada', (o) => primeiro(inteiroPos(o, 'proposta_seq'), exigirEnum(o, 'origem', ORIGENS))],
  ['entrega.inicio', (o) => exigirEnum(o, 'politica', POLITICAS)],
  ['entrega.smoke', (o) => exigirBooleano(o, 'ok')],
  ['entrega.rollback', (o) => exigirBooleano(o, 'ok')],
  [
    'entrega.fim',
    (o) => primeiro(exigirBooleano(o, 'ok'), campo(o, 'motivo') === undefined ? null : exigirEnum(o, 'motivo', MOTIVOS_FIM)),
  ],
  ['entrega.agendada', quando],
  // E4 (GM-12): `spec.aprovada` grava o caminho de `plano.spec` e o sha256 aprovado; `entrega.devolvida` guarda só o motivo (o comando nunca vai ao diário).
  ['spec.aprovada', (o) => primeiro(exigirTexto(o, 'spec'), exigirSha256(o))],
  ['entrega.devolvida', motivoDevolvida],
  // E5a (GM-13): aprendizado do diário, fechamento sem regra e mensagem do dono (hash e tamanho, nunca o texto).
  ['aprendizado', aprendizado],
  ['aprendizado.nada', aprendizadoNada],
  ['dono.mensagem', donoMensagem],
  // GM-14: fato medido (forma exata por chave), anotação do orquestrador e resposta do dono por botão.
  ['fato.medido', fatoMedido],
  ['nota', nota],
  ['dono.resposta', donoResposta],
]);

/** Tipos da E1/E2 que ganharam só campos opcionais: `dados` que não é objeto segue aceito (nada que existe hoje passa a ser recusado). */
const REGRAS_OPCIONAIS                             = new Map               ([
  [
    'ci.resultado',
    (o) => {
      const alvo = campo(o, 'alvo');
      return alvo === undefined || alvo === 'homolog' ? null : 'campo `alvo` inválido: só `homolog` ou ausente';
    },
  ],
  [
    // E4: `modelo` opcional (a task diz com que modelo o agente foi despachado); dado antigo sem o campo segue válido.
    'task.iniciada',
    (o) => {
      const modelo = campo(o, 'modelo');
      return modelo === undefined || (typeof modelo === 'string' && MODELOS_TASK.includes(modelo))
        ? null
        : `campo \`modelo\` inválido: esperado um de ${MODELOS_TASK.join(' | ')}`;
    },
  ],
  [
    // E4: `mutacoes {total, mortas}` opcional (contagem do gate de mutação desta task); `mortas ≤ total`.
    'task.integrada',
    (o) => {
      const m = campo(o, 'mutacoes');
      if (m === undefined) return null;
      const invalido = 'campo `mutacoes` inválido: esperado {total, mortas} inteiros ≥ 0 com mortas ≤ total';
      if (!ehObjeto(m)) return invalido;
      const total = campo(m, 'total');
      const mortas = campo(m, 'mortas');
      const inteiroNaoNegativo = (v         )              => typeof v === 'number' && Number.isInteger(v) && v >= 0;
      return inteiroNaoNegativo(total) && inteiroNaoNegativo(mortas) && mortas <= total ? null : invalido;
    },
  ],
  [
    'custo.medicao',
    (o) => {
      const papel = campo(o, 'papel');
      const modelo = campo(o, 'modelo');
      return primeiro(
        papel === undefined || typeof papel === 'string' ? null : 'campo `papel` inválido: esperado texto',
        modelo === undefined || modelo === null || typeof modelo === 'string' ? null : 'campo `modelo` inválido: esperado texto ou null',
      );
    },
  ],
]);

/**
 * Motivo pelo qual `dados` não tem a forma do tipo, ou `null` (forma ok, ou tipo sem regra). Total: nunca lança.
 * `dados` ausente ⇒ "dados ausente"; `dados` que não é objeto ⇒ "dados corrompido".
 */
export function formaInvalida(tipo        , dados         )                {
  try {
    if (typeof tipo !== 'string') return null;
    const opcional = REGRAS_OPCIONAIS.get(tipo);
    if (opcional !== undefined) return ehObjeto(dados) ? opcional(dados) : null;
    const regra = REGRAS.get(tipo);
    if (regra === undefined) return null;
    if (dados === undefined) return `${tipo}: dados ausente`;
    if (!ehObjeto(dados)) return `${tipo}: dados corrompido (não é um objeto)`;
    const motivo = regra(dados);
    return motivo === null ? null : `${tipo}: ${motivo}`;
  } catch (e) {
    return `${typeof tipo === 'string' ? tipo : 'evento'}: dados corrompido (ilegível: ${e instanceof Error ? e.message : 'erro desconhecido'})`;
  }
}

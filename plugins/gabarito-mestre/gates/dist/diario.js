import { createHash, randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { formaInvalida } from './formas.js';
import { cmp, diarioEmOrdem, duracoes, ehObjeto, mediana, projetarDecisoes } from './diario-puro.js';
                                                      
// Namespace, não nomeado: um `dist/loop.js` sem a lista de progresso não pode derrubar o import inteiro do `diario.js` (o Stop avisa sem `block`, `stop-loop.test.mjs:743`).
import * as loop from './loop.js';
                                                           
                                         

/**
 * Diário mínimo (REQ-DIA-1): um arquivo `events.<sessao>.jsonl` por sessão, cadeia de hash,
 * lock `wx`, canário de segredo e projeção curta. Puro: só `node:` embutido.
 */

// Cronômetro das durações: vive em `diario-puro.ts` (sem `node:*`, o painel o usa); os nomes públicos continuam aqui.
export { duracoes, EM_TRABALHO, mediana } from './diario-puro.js';

// As 10 alternativas de REQ-DIA-1 (E1:72), literais e na ordem da spec.
const CANARIO                                           = [
  ['ghp', /ghp_[A-Za-z0-9]{20,}/],
  ['gho', /gho_[A-Za-z0-9]{20,}/],
  ['gh[sur]', /\bgh[sur]_[A-Za-z0-9]{20,}/],
  ['github_pat', /github_pat_[A-Za-z0-9_]{40,}/],
  ['AKIA', /\bAKIA[A-Z0-9]{12,}/],
  ['ASIA', /\bASIA[A-Z0-9]{12,}/],
  ['BEGIN', /-----BEGIN/],
  ['sk-prefixado', /\bsk-(?:ant|proj|svcacct|admin)-[A-Za-z0-9_-]{32,}/],
  ['sk', /\bsk-[A-Za-z0-9]{16,}/],
  ['xox', /xox[bp]-[A-Za-z0-9-]{10,}/],
  ['url-credencial', /:\/\/[^/\s]+:[^@\s]+@/],
  ['Bearer', /Bearer\s+[A-Za-z0-9._-]{16,}/],
  ['jwt', /eyJ[\w-]{20,}\.eyJ[\w-]{20,}/],
];

const ERRO_MAX = 300;
const LOCK_MAX_IDADE_MS = 2000;
const LOCK_ESPERA_MS = 10;
// Abaixo do `timeout: 5` do hook e acima dos 2 s da quebra de lock órfão.
const LOCK_PRAZO_MS = 3000;
// F3: ≈ 1,5k tokens. O pouso e o `SessionStart:compact` reinjetam isto; o cartão tem seu próprio limite.
const INSTANTANEO_MAX = 3200;
// Bloco de decisões da Sombra (T11), em unidades UTF-16 como o resto do orçamento: cabeçalho, linhas e rodapé.
const DECISOES_MAX = 1600;
const DECISAO_ANCORA_MAX = 64;
const DECISAO_RESPOSTA_MAX = 160;
// Bloco de aprendizados (GM-13 T9): 800 no bloco, 160 na linha inteira (`<E|A> ` + regra em 158).
const APRENDIZADOS_MAX = 800;
const APRENDIZADO_LINHA_MAX = 160;
const LINHA_MAX = 16384;
const CAMPO_MAX = 256;
const ALVO_MAX = 300;
const SESSAO_RE = /^[A-Za-z0-9._-]{1,128}$/;
const PBI_RE = /^[A-Z]+-\d+$/;
const FIM_LEITURA = 65536;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

/** Nome do padrão que casa com o texto, ou `null` se está limpo. */
export function recusaCanario(linha        )                {
  for (const [nome, re] of CANARIO) if (re.test(linha)) return nome;
  return null;
}

/** Canário sobre cada chave e cada string folha, já desserializadas. */
function varrer(valor         )                {
  const pilha            = [valor];
  while (pilha.length > 0) {
    const x = pilha.pop();
    if (typeof x === 'string') {
      const r = recusaCanario(x);
      if (r !== null) return r;
    } else if (Array.isArray(x)) {
      for (const y of x) pilha.push(y);
    } else if (x !== null && typeof x === 'object') {
      for (const [k, y] of Object.entries(x)) {
        const r = recusaCanario(k);
        if (r !== null) return r;
        pilha.push(y);
      }
    }
  }
  return null;
}

const sha = (s        )         => createHash('sha256').update(s).digest('hex');

function dormir(ms        )       {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Pega o lock `wx` (com token do dono); quebra o que tiver mtime a mais de 2 s do relógio
 * (passado ou futuro); tenta a cada 10 ms até o prazo. Lock que não é arquivo regular ⇒ erro.
 */
function pegarLock(lock        , agora              )             {
  const prazo = Date.now() + LOCK_PRAZO_MS;
  const token = `${process.pid}.${randomBytes(8).toString('hex')}`;
  for (;;) {
    if (Date.now() > prazo) throw new Error('lock do diário ocupado');
    try {
      const fd = openSync(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o644);
      try { writeSync(fd, token); } finally { closeSync(fd); }
      return () => {
        try {
          if (readFileSync(lock, 'utf8') === token) unlinkSync(lock);
        } catch { /* já liberado ou de outro dono */ }
      };
    } catch (e) {
      if ((e                         ).code !== 'EEXIST') throw e;
    }
    try {
      const st = lstatSync(lock);
      if (!st.isFile()) throw new Error('lock do diário não é arquivo regular');
      if (Math.abs(agora() - st.mtimeMs) > LOCK_MAX_IDADE_MS) {
        unlinkSync(lock);
        continue;
      }
    } catch (e) {
      if ((e                         ).code === 'ENOENT') continue;
      throw e;
    }
    dormir(LOCK_ESPERA_MS);
  }
}

/** Última linha não vazia e se o arquivo termina sem `\n`, lendo só o fim. */
function lerFim(fd        )                                                {
  const tam = fstatSync(fd).size;
  if (tam === 0) return { ultima: null, semQuebra: false };
  let n = Math.min(tam, FIM_LEITURA);
  for (;;) {
    const buf = Buffer.alloc(n);
    readSync(fd, buf, 0, n, tam - n);
    const txt = buf.toString('utf8');
    const corpo = txt.replace(/\n+$/, '');
    const i = corpo.lastIndexOf('\n');
    if (i >= 0 || n === tam) {
      const ultima = corpo.slice(i + 1);
      return { ultima: ultima === '' ? null : ultima, semQuebra: !txt.endsWith('\n') };
    }
    n = Math.min(tam, n * 2);
  }
}

const campo = (v         )         =>
  typeof v === 'string' && v.length <= CAMPO_MAX && recusaCanario(v) === null ? v : '[redigido]';

export function append(
  dir        ,
  sessao        ,
  ev                                       ,
  opts                           ,
)                                                                           {
  let solto                      = null;
  let fd = -1;
  try {
    if (typeof sessao !== 'string' || !SESSAO_RE.test(sessao)) return { ok: false, erro: 'sessão inválida' };

    // GM-11 T5: forma de `dados` por tipo ANTES do canário; forma inválida não toca arquivo, lock nem linha.
    const forma = formaInvalida(ev.tipo, ev.dados);
    if (forma !== null) {
      // o motivo ecoa o valor bruto. Limite ANTES de qualquer regex: `dados` acima de LINHA_MAX não roda canário e é
      // redigido; a janela do erro tem ERRO_MAX + CAMPO_MAX. Canário sobre os valores crus (o escape do JSON não esconde
      // o segredo) e sobre a janela (segredo que só se forma entre folhas); casou ⇒ [redigido]; só então o corte.
      let grande         ;
      try { grande = (JSON.stringify(ev.dados) ?? '').length > LINHA_MAX; } catch { grande = true; }
      const janela = `forma_invalida: ${forma}`.slice(0, ERRO_MAX + CAMPO_MAX);
      const limpo = !grande && varrer(ev.dados) === null && recusaCanario(janela) === null;
      return { ok: false, erro: limpo ? janela.slice(0, ERRO_MAX) : 'forma_invalida: [redigido]' };
    }

    // canário ANTES do lock; linha grande é recusada sem rodar regex.
    const padrao = JSON.stringify(ev).length > LINHA_MAX ? 'tamanho' : varrer(ev);

    mkdirSync(dir, { recursive: true });
    const arquivo = join(dir, `events.${sessao}.jsonl`);
    solto = pegarLock(`${arquivo}.lock`, opts?.agora ?? Date.now);

    // seq e hash lidos da última linha DENTRO do lock.
    fd = openSync(arquivo, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | NOFOLLOW, 0o644);
    const { ultima, semQuebra } = lerFim(fd);
    let seq = 1;
    if (ultima !== null) {
      let anterior                = null;
      try {
        const n = (JSON.parse(ultima)                            )?.seq;
        if (typeof n === 'number' && Number.isFinite(n)) anterior = n;
      } catch { /* linha ilegível */ }
      if (anterior === null) {
        // fallback: contagem de linhas (custa o arquivo inteiro, mas só no caso raro)
        anterior = readFileSync(arquivo, 'utf8').split('\n').filter((l) => l !== '').length;
      }
      seq = anterior + 1;
    }
    const hash_anterior = ultima === null ? null : sha(ultima);

    const registro = padrao === null
      ? Object.assign({ seq }, ev, { seq, hash_anterior })
      : {
        seq, ts: campo(ev.ts), autor: campo(ev.autor), sessao: campo(ev.sessao), agente: campo(ev.agente),
        tipo: 'diario.recusa', dados: { tipo: campo(ev.tipo), padrao }, hash_anterior,
      };
    writeSync(fd, (semQuebra ? '\n' : '') + JSON.stringify(registro) + '\n');
    return { ok: true, gravado: padrao === null ? 'evento' : 'recusa' };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  } finally {
    if (fd >= 0) { try { closeSync(fd); } catch { /* nada */ } }
    if (solto) solto();
  }
}

export function ler(dir        )           {
  let nomes          ;
  try {
    nomes = readdirSync(dir).filter((n) => /^events\..+\.jsonl$/.test(n));
  } catch {
    return [];
  }
  const out           = [];
  for (const nome of nomes.sort()) {
    let bruto        ;
    try {
      bruto = readFileSync(join(dir, nome), 'utf8');
    } catch {
      continue;
    }
    for (const l of bruto.split('\n')) {
      if (l === '') continue;
      try {
        const o = JSON.parse(l)           ;
        if (o !== null && typeof o === 'object') out.push(o          );
      } catch { /* linha corrompida é ignorada */ }
    }
  }
  return out;
}

                                                                                             

/**
 * Leitura SEM tolerância, para decisão irreversível (pouso). Ao contrário de `ler`, nada é descartado em silêncio:
 * pasta ou arquivo ilegível, linha que não é um objeto JSON, `seq` fora de 1, 2, 3… no arquivo da sessão e
 * `hash_anterior` que não confere com a linha anterior viram `{ ok: false, motivo }`.
 */
export function lerEstrito(dir        )                 {
  let nomes          ;
  try {
    nomes = readdirSync(dir).filter((n) => /^events\..+\.jsonl$/.test(n));
  } catch {
    return { ok: false, motivo: 'pasta do diário ilegível' };
  }
  const out           = [];
  for (const nome of nomes.sort()) {
    let bruto        ;
    try {
      bruto = readFileSync(join(dir, nome), 'utf8');
    } catch {
      return { ok: false, motivo: `arquivo ilegível: ${nome}` };
    }
    const linhas = bruto.split('\n');
    if (linhas[linhas.length - 1] === '') linhas.pop();
    for (let i = 0; i < linhas.length; i++) {
      let o         ;
      try {
        o = JSON.parse(linhas[i]);
      } catch {
        return { ok: false, motivo: `linha ${i + 1} ilegível em ${nome}` };
      }
      if (o === null || typeof o !== 'object' || Array.isArray(o)) return { ok: false, motivo: `linha ${i + 1} não é evento em ${nome}` };
      const e = o                           ;
      if (e.seq !== i + 1) return { ok: false, motivo: `lacuna de seq na linha ${i + 1} de ${nome}` };
      if (e.hash_anterior !== (i === 0 ? null : sha(linhas[i - 1]))) return { ok: false, motivo: `hash_anterior não confere na linha ${i + 1} de ${nome}` };
      out.push(o          );
    }
  }
  return { ok: true, eventos: out };
}

/**
 * Árvore de aprendizados (GM-13 T2): `<dirEntregas>/<entrega>/events.*.jsonl` por `lerEstrito`. Entrega ilegível fica fora e
 * gera o aviso `aprendizados: <entrega> ilegível (<motivo>)`; pasta ausente ⇒ mapa vazio sem aviso (ausente ≠ corrompido);
 * pasta que existe mas não lista ⇒ aviso. Nunca lança.
 */
export function lerAprendizados(dirEntregas        )                                                          {
  const porEntrega = new Map                  ();
  const avisos           = [];
  let nomes          ;
  try {
    nomes = readdirSync(dirEntregas, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch (e) {
    if ((e                                )?.code !== 'ENOENT') avisos.push(`aprendizados: ${dirEntregas} ilegível (pasta das entregas não lista)`);
    return { porEntrega, avisos };
  }
  for (const nome of nomes) {
    try {
      const r = lerEstrito(join(dirEntregas, nome));
      if (r.ok) porEntrega.set(nome, r.eventos);
      else avisos.push(`aprendizados: ${nome} ilegível (${r.motivo})`);
    } catch (e) {
      avisos.push(`aprendizados: ${nome} ilegível (${e instanceof Error ? e.message : 'erro desconhecido'})`);
    }
  }
  return { porEntrega, avisos };
}

/** Corta em `n` unidades e não deixa meio par substituto no fim. */
function corta(s        , n        )         {
  const c = s.slice(0, n);
  const u = c.charCodeAt(c.length - 1);
  return c.length === n && u >= 0xd800 && u <= 0xdbff ? c.slice(0, -1) : c;
}

const CONTROLE = /[\u0000-\u001f\u007f\u2028\u2029]+/g;
const semControle = (t        )         => t.replace(CONTROLE, ' ');
const rodapeDecisoes = (fora        )         => `... ${fora} decisão(ões) fora`;
const AVISO_FORA_DE_ORDEM = 'Decisões da Sombra: diário fora de ordem';

/** Ordem do bloco: mais recente primeiro por `(ts, sessao, seq)`, a mesma de `projetarDecisoes`. `ts` já foi validado por `diarioEmOrdem`. */
function maisRecenteAntes(a               , b               )         {
  return Date.parse(b.ts) - Date.parse(a.ts) || cmp(b.sessao, a.sessao) || b.seq - a.seq;
}

/**
 * Bloco de decisões vigentes (REQ-SOM-1). `entrada` já está em `(sessao, seq)`. Fora de ordem ⇒ linha de aviso (corrompido ≠ ausente);
 * nenhuma decisão ⇒ sem bloco. Orçamento: cabeçalho + rodapé do pior caso reservados antes da 1ª linha; o bloco final tem ≤ DECISOES_MAX.
 */
function blocoDecisoes(entrada          )                                         {
  if (!diarioEmOrdem(entrada)) return { linhas: [AVISO_FORA_DE_ORDEM], decisoes: 0 };
  const vigentes = [...projetarDecisoes(entrada).values()].sort(maisRecenteAntes);
  if (vigentes.length === 0) return { linhas: [], decisoes: 0 };
  const cabecalho = `Decisões da Sombra (${vigentes.length}):`;
  let usado = cabecalho.length + 1 + rodapeDecisoes(vigentes.length).length + 1;
  const linhas           = [];
  for (const d of vigentes) {
    const ancora = d.req ?? `task:${d.task}`;
    const linha = `${corta(semControle(ancora), DECISAO_ANCORA_MAX)} ${d.hash.slice(0, 8)} ${corta(semControle(d.resposta), DECISAO_RESPOSTA_MAX)}`;
    if (usado + linha.length + 1 > DECISOES_MAX) break;
    linhas.push(linha);
    usado += linha.length + 1;
  }
  const fora = vigentes.length - linhas.length;
  return { linhas: [cabecalho, ...linhas, ...(fora > 0 ? [rodapeDecisoes(fora)] : [])], decisoes: vigentes.length };
}

const CONTROLE_APR = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
const rodapeAprendizados = (fora        )         => `... ${fora} aprendizado(s) fora`;
const avisoArvore = (k        )         => `Aprendizados: ${k} entrega(s) ilegível(is); veja loop.mjs aprendizados`;

/** D com `instantaneo`, de forma própria: `projetar` não confia no chamador (M nunca entra, item torto não lança). */
function aprendizadosDoInstantaneo(lista         )                       {
  if (!Array.isArray(lista)) return [];
  return lista.filter((a)                          => ehObjeto(a) && a.status === 'D' && Array.isArray(a.entra_em) && a.entra_em.includes('instantaneo')
    && typeof a.regra === 'string' && (a.tipo === 'E' || a.tipo === 'A'));
}

/**
 * Bloco de aprendizados D (REQ-APR-3): depois das decisões. Cabeçalho, aviso da árvore e rodapé do pior caso reservados antes da 1ª linha;
 * o bloco final tem ≤ APRENDIZADOS_MAX. Sem D e sem aviso ⇒ sem bloco (saída da E4 byte a byte).
 */
function blocoAprendizados(lista                      , avisos          )           {
  if (lista.length === 0 && avisos.length === 0) return [];
  const cabecalho = `Aprendizados (${lista.length}):`;
  const aviso = avisos.length > 0 ? [avisoArvore(avisos.length)] : [];
  let usado = cabecalho.length + 1 + aviso.reduce((n, l) => n + l.length + 1, 0) + rodapeAprendizados(lista.length).length + 1;
  const linhas           = [];
  for (const a of lista) {
    const linha = `${a.tipo} ${corta(a.regra.replace(CONTROLE_APR, ' '), APRENDIZADO_LINHA_MAX - 2)}`;
    if (usado + linha.length + 1 > APRENDIZADOS_MAX) break;
    linhas.push(linha);
    usado += linha.length + 1;
  }
  const fora = lista.length - linhas.length;
  return [cabecalho, ...aviso, ...linhas, ...(fora > 0 ? [rodapeAprendizados(fora)] : [])];
}

export function projetar(eventos          , opcoes                                                                         )                                                                                                                                               {
  const validos = eventos.filter((e) => e !== null && typeof e === 'object');
  const resumo                         = {};
  for (const e of validos) resumo[e.tipo] = (resumo[e.tipo] ?? 0) + 1;

  // mais recentes primeiro, por (ts, sessao)
  const ordenados = [...validos].sort((a, b) => cmp(String(b.ts), String(a.ts)) || cmp(String(b.sessao), String(a.sessao)));
  const medidas = duracoes(validos);
  const eta = medidas.length >= 3 ? { medianaS: mediana(medidas), n: medidas.length } : null;
  const linhaEta = eta === null ? 'ETA: sem dados' : `ETA: ${eta.n} tasks, mediana ${Math.round(eta.medianaS * 10) / 10} s`;
  const cabecalho = `Diário: ${validos.length} evento(s)`;
  const rodape = (omitidos        )         => `... ${omitidos} anterior(es) omitido(s)`;

  // a entrada vai para (sessao, seq) antes de projetar decisões, como em `duracaoDaTask`: a ordem de chegada não pode mudar a saída
  const porSeq = [...validos].sort((a, b) => cmp(String(a.sessao), String(b.sessao)) || Number(a.seq) - Number(b.seq));
  const bloco = blocoDecisoes(porSeq);
  const doInstantaneo = aprendizadosDoInstantaneo(opcoes?.aprendizados);
  const avisos = Array.isArray(opcoes?.avisosAprendizados) ? opcoes.avisosAprendizados : [];
  const blocoApr = blocoAprendizados(doInstantaneo, avisos);

  const linhas           = [];
  // orçamento: cabeçalho + ETA + bloco de decisões + rodapé do pior caso + quebras, reservados antes dos eventos
  let usado = cabecalho.length + linhaEta.length + rodape(validos.length).length + 3 + (bloco.linhas.length > 0 ? bloco.linhas.join('\n').length + 1 : 0)
    + (blocoApr.length > 0 ? blocoApr.join('\n').length + 1 : 0);
  for (const e of ordenados) {
    const alvo = corta(String(ehObjeto(e.dados) ? (e.dados.alvo ?? '-') : '-').replace(/[\r\n]+/g, ' '), ALVO_MAX);
    const linha = `${corta(String(e.ts), 40)} ${corta(String(e.tipo), 64)} ${alvo}`;
    if (usado + linha.length + 1 > INSTANTANEO_MAX) break;
    linhas.push(linha);
    usado += linha.length + 1;
  }
  const omitidos = validos.length - linhas.length;
  const partes = [cabecalho, linhaEta, ...bloco.linhas, ...blocoApr, ...linhas];
  if (omitidos > 0) partes.push(rodape(omitidos));
  return { instantaneo: partes.join('\n'), resumo, eta, decisoes: bloco.decisoes, aprendizados: doInstantaneo.length };
}

/**
 * Pouso que ninguém retomou (REQ-POU-3, Sombra P1-c D-P1c-4): o último `sessao.pouso`, na ordem de `ordenar` (nunca a do arquivo), sem
 * `sessao.retomada`, `loop.parar` nem evento de progresso depois. Puro; vazio, não array, sem pouso ou ordem inválida ⇒ `false`.
 */
export function pousoSemRetomada(eventos          )          {
  if (!Array.isArray(eventos)) return false;
  try {
    const o = loop.ordenar(eventos);
    if (!o.ok) return false;
    let ultimo = -1;
    o.eventos.forEach((e, i) => { if (e.tipo === 'sessao.pouso') ultimo = i; });
    if (ultimo < 0) return false;
    return !o.eventos.slice(ultimo + 1).some((e) => e.tipo === 'sessao.retomada' || e.tipo === 'loop.parar' || loop.TIPOS_DE_PROGRESSO.includes(e.tipo));
  } catch {
    return false;
  }
}

export function dirEntrega(raiz        , pbi               )         {
  return join(raiz, '.harness', 'entregas', pbi !== null && PBI_RE.test(pbi) ? pbi : '_sem-id');
}

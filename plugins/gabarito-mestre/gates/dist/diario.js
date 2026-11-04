import { createHash, randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { estadoDe, ordenar } from './loop.js';
                                            
                                         

/**
 * Diário mínimo (REQ-DIA-1): um arquivo `events.<sessao>.jsonl` por sessão, cadeia de hash,
 * lock `wx`, canário de segredo e projeção curta. Puro: só `node:` embutido.
 */

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

const LOCK_MAX_IDADE_MS = 2000;
const LOCK_ESPERA_MS = 10;
// Abaixo do `timeout: 5` do hook e acima dos 2 s da quebra de lock órfão.
const LOCK_PRAZO_MS = 3000;
// F3: ≈ 1,5k tokens. O pouso e o `SessionStart:compact` reinjetam isto; o cartão tem seu próprio limite.
const INSTANTANEO_MAX = 3200;
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

const cmp = (a        , b        )         => (a < b ? -1 : a > b ? 1 : 0);

/** Corta em `n` unidades e não deixa meio par substituto no fim. */
function corta(s        , n        )         {
  const c = s.slice(0, n);
  const u = c.charCodeAt(c.length - 1);
  return c.length === n && u >= 0xd800 && u <= 0xdbff ? c.slice(0, -1) : c;
}

const ehObjeto = (x         )                               => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Task com trabalho em curso: o cronômetro anda enquanto o estado da T2 está aqui. */
const EM_TRABALHO                          = new Set            (['implementando', 'concluida', 'em_revisao', 'corrigindo']);
const TIPOS_DE_TASK                      = new Set(['task.iniciada', 'task.concluida', 'review.veredito', 'task.integrada', 'task.reaberta']);

/**
 * Duração de UMA task aprovada (REQ-OBS-1), seguindo a transição da T2 (`estadoDe`) e nunca lendo
 * `tipo`/`papel`/`origem` por conta própria. Soma dos intervalos em trabalho que terminaram em veredito;
 * tentativa abandonada por retomada não entra; voltar a `pendente` recomeça do zero. `null`: task não
 * aprovada, ou sequência que a T2 rejeita (a projeção não inventa número).
 */
function duracaoDaTask(fila          )                {
  // `ordenar` da T2 só aceita cada sessão em ordem de `seq`; a ordem de entrada daqui não é garantida.
  const porSeq = [...fila].sort((a, b) => cmp(String(a.sessao), String(b.sessao)) || Number(a.seq) - Number(b.seq));
  const ord = ordenar(porSeq);
  if (!ord.ok) return null;
  let aberta                    ;
  let acumulado                    ;
  let feita                = null;
  let antes             = 'pendente';
  for (let i = 0; i < ord.eventos.length; i++) {
    const r = estadoDe(ord.eventos.slice(0, i + 1));
    if ('invalido' in r) return null;
    const e = ord.eventos[i];
    const t = Date.parse(e.ts); // `ordenar` já barrou ts inválido
    const depois = r.estado;
    if (depois === 'pendente' && antes !== 'pendente') {
      aberta = undefined;
      acumulado = undefined;
    } else if (!EM_TRABALHO.has(antes) && EM_TRABALHO.has(depois)) {
      aberta = t;
    } else if (EM_TRABALHO.has(antes) && !EM_TRABALHO.has(depois)) {
      const ini = aberta;
      aberta = undefined;
      // saída por reabertura = tentativa abandonada, não soma; saída por veredito soma o intervalo (se for coerente)
      if (e.tipo === 'review.veredito') {
        if (ini !== undefined && t >= ini) acumulado = (acumulado ?? 0) + (t - ini);
        if (depois === 'aprovada' && acumulado !== undefined) feita = acumulado / 1000;
      }
    }
    antes = depois;
  }
  return feita;
}

/** Duração por task aprovada: agrupa por task e delega a cada uma o `duracaoDaTask`. */
function duracoes(eventos          )           {
  const porTask = new Map                  ();
  for (const e of eventos) {
    if (!TIPOS_DE_TASK.has(e.tipo) || !ehObjeto(e.dados) || typeof e.dados.task !== 'string') continue;
    const fila = porTask.get(e.dados.task) ?? [];
    fila.push(e);
    porTask.set(e.dados.task, fila);
  }
  const feitas           = [];
  for (const fila of porTask.values()) {
    const d = duracaoDaTask(fila);
    if (d !== null) feitas.push(d);
  }
  return feitas;
}

function mediana(xs          )         {
  const o = [...xs].sort((a, b) => a - b);
  const m = o.length >> 1;
  return o.length % 2 === 1 ? o[m] : (o[m - 1] + o[m]) / 2;
}

export function projetar(eventos          )                                                                                                       {
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

  const linhas           = [];
  // orçamento: cabeçalho + ETA + rodapé do pior caso + quebras, reservados antes dos eventos
  let usado = cabecalho.length + linhaEta.length + rodape(validos.length).length + 3;
  for (const e of ordenados) {
    const alvo = corta(String(ehObjeto(e.dados) ? (e.dados.alvo ?? '-') : '-').replace(/[\r\n]+/g, ' '), ALVO_MAX);
    const linha = `${corta(String(e.ts), 40)} ${corta(String(e.tipo), 64)} ${alvo}`;
    if (usado + linha.length + 1 > INSTANTANEO_MAX) break;
    linhas.push(linha);
    usado += linha.length + 1;
  }
  const omitidos = validos.length - linhas.length;
  const partes = [cabecalho, linhaEta, ...linhas];
  if (omitidos > 0) partes.push(rodape(omitidos));
  return { instantaneo: partes.join('\n'), resumo, eta };
}

export function dirEntrega(raiz        , pbi               )         {
  return join(raiz, '.harness', 'entregas', pbi !== null && PBI_RE.test(pbi) ? pbi : '_sem-id');
}

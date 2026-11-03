import { createHash, randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
                                         

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

const cmp = (a        , b        )         => (a < b ? -1 : a > b ? 1 : 0);

/** Corta em `n` unidades e não deixa meio par substituto no fim. */
function corta(s        , n        )         {
  const c = s.slice(0, n);
  const u = c.charCodeAt(c.length - 1);
  return c.length === n && u >= 0xd800 && u <= 0xdbff ? c.slice(0, -1) : c;
}

const ehObjeto = (x         )                               => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Duração por task aprovada: `task.iniciada` do implementador até `review.veredito` APROVADO; rodadas somam. */
function duracoes(ordemCrescente          )           {
  const aberta = new Map                ();
  const acumulado = new Map                ();
  const feitas           = [];
  const ms = (ts         )         => (typeof ts === 'string' ? Date.parse(ts) : NaN);
  for (const e of ordemCrescente) {
    if (!ehObjeto(e.dados) || typeof e.dados.task !== 'string') continue;
    const task = e.dados.task;
    if (e.tipo === 'task.reaberta') {
      aberta.delete(task);
      acumulado.delete(task);
    } else if (e.tipo === 'task.iniciada') {
      // correção só reabre contagem de task já reprovada; revisor nunca abre
      const papel = e.dados.papel;
      if (papel !== 'implementador' && !(papel === 'correcao' && acumulado.has(task))) continue;
      const t = ms(e.ts);
      if (Number.isNaN(t)) aberta.delete(task);
      else aberta.set(task, t);
    } else if (e.tipo === 'review.veredito') {
      const ini = aberta.get(task);
      if (ini === undefined) continue;
      aberta.delete(task);
      const fim = ms(e.ts);
      if (Number.isNaN(fim) || fim < ini) continue;
      acumulado.set(task, (acumulado.get(task) ?? 0) + (fim - ini));
      if (e.dados.veredito === 'APROVADO') {
        feitas.push((acumulado.get(task)          ) / 1000);
        acumulado.delete(task);
      }
    }
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
  const medidas = duracoes([...ordenados].reverse());
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

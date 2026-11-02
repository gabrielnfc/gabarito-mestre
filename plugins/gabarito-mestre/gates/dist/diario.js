import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
                                         

/**
 * Diário mínimo (REQ-DIA-1): um arquivo `events.<sessao>.jsonl` por sessão, cadeia de hash,
 * lock `wx`, canário de segredo e projeção curta. Puro: só `node:` embutido.
 */

// As 10 alternativas de REQ-DIA-1 (E1:72), literais e na ordem da spec.
const CANARIO                                           = [
  ['ghp', /ghp_[A-Za-z0-9]{20,}/],
  ['gho', /gho_[A-Za-z0-9]{20,}/],
  ['AKIA', /\bAKIA[A-Z0-9]{12,}/],
  ['ASIA', /\bASIA[A-Z0-9]{12,}/],
  ['BEGIN', /-----BEGIN/],
  ['sk', /\bsk-[A-Za-z0-9]{16,}/],
  ['xox', /xox[bp]-[A-Za-z0-9-]{10,}/],
  ['url-credencial', /:\/\/[^/\s]+:[^@\s]+@/],
  ['Bearer', /Bearer\s+[A-Za-z0-9._-]{16,}/],
  ['jwt', /eyJ[\w-]{20,}\.eyJ[\w-]{20,}/],
];

const LOCK_MAX_IDADE_MS = 2000;
const LOCK_ESPERA_MS = 10;
const LOCK_PRAZO_MS = 10000;
const INSTANTANEO_MAX = 6000;

/** Nome do padrão que casa com a linha, ou `null` se a linha está limpa. */
export function recusaCanario(linha        )                {
  for (const [nome, re] of CANARIO) if (re.test(linha)) return nome;
  return null;
}

const sha = (s        )         => createHash('sha256').update(s).digest('hex');

function dormir(ms        )       {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Pega o lock `wx`; quebra o que tiver mtime > 2 s; tenta a cada 10 ms. Devolve o que liberar. */
function pegarLock(lock        , agora              )             {
  const prazo = Date.now() + LOCK_PRAZO_MS;
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'));
      return () => {
        try { unlinkSync(lock); } catch { /* já liberado */ }
      };
    } catch (e) {
      if ((e                         ).code !== 'EEXIST') throw e;
    }
    try {
      if (agora() - statSync(lock).mtimeMs > LOCK_MAX_IDADE_MS) {
        unlinkSync(lock);
        continue;
      }
    } catch (e) {
      if ((e                         ).code === 'ENOENT') continue;
      throw e;
    }
    if (Date.now() > prazo) throw new Error('lock do diário ocupado');
    dormir(LOCK_ESPERA_MS);
  }
}

export function append(
  dir        ,
  sessao        ,
  ev                                       ,
  opts                           ,
)                                                                           {
  let solto                      = null;
  try {
    mkdirSync(dir, { recursive: true });
    const arquivo = join(dir, `events.${sessao}.jsonl`);
    solto = pegarLock(`${arquivo}.lock`, opts?.agora ?? Date.now);

    // seq e hash lidos da última linha DENTRO do lock.
    let bruto = '';
    try {
      bruto = readFileSync(arquivo, 'utf8');
    } catch (e) {
      if ((e                         ).code !== 'ENOENT') throw e;
    }
    const ls = bruto.split('\n').filter((l) => l !== '');
    const ultima = ls.length > 0 ? ls[ls.length - 1] : null;
    let seq = 1;
    if (ultima !== null) {
      let anterior = ls.length;
      try {
        const n = (JSON.parse(ultima)                     ).seq;
        if (typeof n === 'number' && Number.isFinite(n)) anterior = n;
      } catch { /* linha ilegível: cai para a contagem de linhas; o hash ainda a encadeia */ }
      seq = anterior + 1;
    }
    const hash_anterior = ultima === null ? null : sha(ultima);

    let linha = JSON.stringify({ seq, ...ev, hash_anterior });
    let gravado                      = 'evento';
    const padrao = recusaCanario(linha);
    if (padrao !== null) {
      gravado = 'recusa';
      const { ts, autor, agente } = ev;
      linha = JSON.stringify({ seq, ts, autor, sessao: ev.sessao, agente, tipo: 'diario.recusa', dados: { tipo: ev.tipo, padrao }, hash_anterior });
    }
    appendFileSync(arquivo, (bruto !== '' && !bruto.endsWith('\n') ? '\n' : '') + linha + '\n');
    return { ok: true, gravado };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  } finally {
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
        out.push(JSON.parse(l)          );
      } catch { /* linha corrompida é ignorada */ }
    }
  }
  return out;
}

const cmp = (a        , b        )         => (a < b ? -1 : a > b ? 1 : 0);

export function projetar(eventos          )                                                          {
  const resumo                         = {};
  for (const e of eventos) resumo[e.tipo] = (resumo[e.tipo] ?? 0) + 1;

  // mais recentes primeiro, por (ts, sessao)
  const ordenados = [...eventos].sort((a, b) => cmp(b.ts, a.ts) || cmp(b.sessao, a.sessao));
  const cabecalho = `Diário: ${eventos.length} evento(s)`;
  const rodape = (omitidos        )         => `... ${omitidos} anterior(es) omitido(s)`;

  const linhas           = [];
  // orçamento: cabeçalho + rodapé do pior caso + quebras; cada evento é uma linha inteira
  let usado = cabecalho.length + rodape(eventos.length).length + 2;
  for (const e of ordenados) {
    const alvo = String(e.dados?.alvo ?? '-').replace(/[\r\n]+/g, ' ');
    const linha = `${e.ts} ${e.tipo} ${alvo}`;
    if (usado + linha.length + 1 > INSTANTANEO_MAX) break;
    linhas.push(linha);
    usado += linha.length + 1;
  }
  const omitidos = eventos.length - linhas.length;
  const partes = [cabecalho, ...linhas];
  if (omitidos > 0) partes.push(rodape(omitidos));
  return { instantaneo: partes.join('\n'), resumo };
}

export function dirEntrega(raiz        , pbi               )         {
  return join(raiz, '.harness', 'entregas', pbi ?? '_sem-id');
}

/**
 * Hora local do painel (GM-12 T1b): data civil e `hh:mm` num fuso IANA, 24 h. Núcleo puro, sem relógio e sem módulo embutido do Node
 * (o mod carrega o `dist/`; ver `loop.ts`), só `Intl.DateTimeFormat`, que o Node e o mod já trazem.
 * Fuso inválido nunca lança: cai em `UTC`. Instante não finito não vira data nem hora: `''` e `--:--`.
 */

const formatadores = new Map                             ();

function formatador(fuso        )                      {
  const chave = fuso;
  let f = formatadores.get(chave);
  if (!f) {
    // en-GB + h23: `hh:mm` de 00 a 23 (nunca "24:00", nunca AM/PM) e partes numéricas com 2 dígitos.
    f = new Intl.DateTimeFormat('en-GB', { timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    formatadores.set(chave, f);
  }
  return f;
}

/** O próprio fuso se o `Intl` o aceita; qualquer outra coisa (texto desconhecido, vazio, não texto) ⇒ `'UTC'`. Nunca lança. */
export function fusoValido(fuso        )         {
  if (typeof fuso !== 'string' || fuso.trim() === '') return 'UTC';
  try {
    formatador(fuso);
    return fuso;
  } catch {
    return 'UTC';
  }
}

                                                                                      

/** `null` quando `ms` não é número ou não é instante representável (NaN, infinito, além de ±8,64e15: o `Intl` lança `RangeError`). */
function partes(ms        , fuso        )                {
  if (typeof ms !== 'number') return null; // o `Intl` converte texto em número; aqui não
  let lista                           ;
  try {
    lista = formatador(fusoValido(fuso)).formatToParts(ms);
  } catch {
    return null;
  }
  const p                         = {};
  for (const x of lista) p[x.type] = x.value;
  return { ano: p.year, mes: p.month, dia: p.day, hora: p.hour, minuto: p.minute };
}

/** `AAAA-MM-DD` do instante no fuso; `''` se o instante não vale. */
export function dataCivil(ms        , fuso        )         {
  const p = partes(ms, fuso);
  return p ? `${p.ano}-${p.mes}-${p.dia}` : '';
}

/** `hh:mm` se a data civil de `ms` é a de `agoraMs` no fuso; senão `dd/mm hh:mm`. `ms` inválido ⇒ `--:--`. */
export function horaLocal(ms        , agoraMs        , fuso        )         {
  const p = partes(ms, fuso);
  if (!p) return '--:--';
  const hm = `${p.hora}:${p.minuto}`;
  const agora = dataCivil(agoraMs, fuso);
  return agora === `${p.ano}-${p.mes}-${p.dia}` ? hm : `${p.dia}/${p.mes} ${hm}`;
}
